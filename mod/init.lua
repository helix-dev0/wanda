-- =============================================================================
-- wand_capture - state-extraction mod for the Noita wand assistant.
--
-- Responsibility: STATE EXTRACTION ONLY (no logic, no UI). It AUTO-SYNCS a
-- schema-shaped snapshot JSON (all carried wands + spell bag + acquired perks) to
-- snapshot.json whenever the state changes (~2x/sec) — the live bridge watches that
-- file, so the app updates with NO keypress. F8 dumps the full spell + perk
-- databases once (the heavy, occasional export).
--
-- THIS CODE CANNOT BE SELF-TESTED - it needs the running game. The human is the
-- test loop (see docs/capture-manual.md). Every API call here is grounded in real
-- source (EZWand, vanilla scripts, the Advanced Spell Inventory mod's own code, the
-- official Lua API). DO NOT assume this works until the human confirms in-game.
--
-- Hotkey:  F8 (scancode 65) = dump spell + perk DBs.  (Snapshot capture is automatic.)
-- =============================================================================

local MODID = "wand_capture"
local EZWand = dofile_once("mods/" .. MODID .. "/EZWand.lua")
local json = dofile_once("mods/" .. MODID .. "/json.lua")
local NULL = json.NULL

local player_entity = nil
local run_id = "run-unknown"
local last_emit = nil -- last snapshot.json contents (emit-on-change, sans timestamp)

-- --- file output ------------------------------------------------------------
-- Relative path -> the game's working directory. Per research this is most
-- likely the install dir (NOT the save dir); the absolute save-dir path needs a
-- per-OS trick that is Windows-only, so M0 writes relatively and logs the result
-- for the human to locate (resolves the path question for M1).
local function write_file(path, contents)
  local f = io.open(path, "w")
  if not f then return false end
  f:write(contents)
  f:close()
  return true
end

-- --- wand reading (via EZWand) ----------------------------------------------
-- Build the ordered deck array with NULL for empty slots. EZWand:GetSpells()
-- returns a dense list with inventory_x positions (unreliable until the wand's
-- inventory has been opened in-game - see manual), so place each spell at its
-- inventory_x and leave NULL gaps; append anything out of range.
local function build_deck(spells, capacity)
  local deck = json.array({})
  local cap = math.floor((capacity or 0) + 0.5)
  for i = 1, cap do deck[i] = NULL end
  for _, s in ipairs(spells) do
    local x = s.inventory_x -- EZWand inventory_x is 0-based (slot 0 = first)
    if type(x) == "number" and x >= 0 and x < cap then
      deck[x + 1] = s.action_id -- 0-based slot -> 1-based Lua array
    else
      deck[#deck + 1] = s.action_id -- genuinely out of range: append
    end
  end
  return deck
end

-- `w` is an EZWand object (e.g. from EZWand.GetHeldWand()).
local function read_wand(w, slot)
  local p = w:GetProperties() -- camelCase keys, matches our snapshot stats
  local spells, always = w:GetSpells()
  local ac = json.array({})
  for _, s in ipairs(always) do ac[#ac + 1] = s.action_id end
  return {
    slot = slot,
    stats = {
      shuffle = p.shuffle,
      spellsPerCast = p.spellsPerCast,
      castDelay = p.castDelay,
      rechargeTime = p.rechargeTime,
      manaMax = p.manaMax,
      mana = p.mana,
      manaChargeSpeed = p.manaChargeSpeed,
      capacity = p.capacity, -- EZWand UI capacity (always-casts subtracted)
      spread = p.spread,
      speedMultiplier = p.speedMultiplier,
    },
    always_cast = ac,
    spells = build_deck(spells, p.capacity),
  }
end

-- --- perks ------------------------------------------------------------------
local function ensure_perk_list()
  if perk_list == nil then dofile("data/scripts/perks/perk_list.lua") end
  return perk_list
end

-- Acquired perks via the run flag PERK_PICKED_<id>. The _PICKUP_COUNT global is
-- read with a default of "1" so `stacks` degrades gracefully whether or not the
-- running game's build maintains it (sources disagree - confirm in-game).
local function read_perks()
  local list = ensure_perk_list()
  local out = json.array({})
  if list then
    for _, perk in ipairs(list) do
      local id = perk.id
      if id and GameHasFlagRun("PERK_PICKED_" .. id) then
        local stacks = tonumber(GlobalsGetValue("PERK_PICKED_" .. id .. "_PICKUP_COUNT", "1")) or 1
        out[#out + 1] = { id = id, stacks = stacks }
      end
    end
  end
  return out
end

-- --- loose spell bag --------------------------------------------------------
-- Loose spells live in TWO places, and we UNION both (a spell is in exactly one of
-- them at a time, so no double-counting):
--   (1) VANILLA: the player child entity named "inventory_full" holds one child
--       entity per spell (ItemActionComponent.action_id + ItemComponent.uses_remaining).
--   (2) ADVANCED SPELL INVENTORY (Workshop 3267869519): this QoL mod's "storage" does
--       NOT use child entities — it serializes its (expanded, STACKED) bag into a single
--       Globals STRING and empties inventory_full into it, so a vanilla-only read misses
--       every stored spell. Source-verified against ASI init.lua (save_stored_spells):
--         GlobalsGetValue("AdvancedSpellInventory_stored_spells")
--         = "<stack_size>;<action_id>;<uses_remaining>" per slot, joined by "|", "" for empty.
--       We expand each stack into <stack_size> entries so the app's owned-counts are correct.
--   Both reads no-op when their source is absent (no ASI ⇒ the Globals key is ""), so this
--   is safe with or without ASI. Format coupling is intentional (CLAUDE.md: read ASI
--   compatibly) and version-flagged: re-verify the key/format if ASI changes its storage.
local ASI_STORAGE_KEY = "AdvancedSpellInventory_stored_spells"

local function read_vanilla_bag(player, out)
  local bag = nil
  for _, c in ipairs(EntityGetAllChildren(player) or {}) do
    if EntityGetName(c) == "inventory_full" then
      bag = c
      break
    end
  end
  if not bag then return end
  for _, item in ipairs(EntityGetAllChildren(bag) or {}) do
    local iac = EntityGetFirstComponentIncludingDisabled(item, "ItemActionComponent")
    if iac then
      local action_id = ComponentGetValue2(iac, "action_id")
      local uses = NULL
      local ic = EntityGetFirstComponentIncludingDisabled(item, "ItemComponent")
      if ic then
        local u = ComponentGetValue2(ic, "uses_remaining")
        if type(u) == "number" then uses = u end
      end
      out[#out + 1] = { action_id = action_id, uses_remaining = uses }
    end
  end
end

local function read_asi_storage(out)
  local serialized = GlobalsGetValue(ASI_STORAGE_KEY, "")
  if serialized == "" then return end -- ASI not installed, or its storage is empty
  -- Trailing "|" so the final entry is captured by the [^|]* pattern.
  for entry in (serialized .. "|"):gmatch("([^|]*)|") do
    if entry ~= "" then
      local stack, action_id, uses = entry:match("^(%-?%d+);([^;]*);(%-?%d+)$")
      if action_id and action_id ~= "" then
        local n = tonumber(stack) or 1
        local u = tonumber(uses)
        -- ASI stores -1 (or absent) for unlimited; mirror the vanilla read's NULL for that.
        local uses_val = (type(u) == "number" and u >= 0) and u or NULL
        for _ = 1, n do
          out[#out + 1] = { action_id = action_id, uses_remaining = uses_val }
        end
      end
    end
  end
end

local function read_spell_bag(player)
  local out = json.array({})
  read_vanilla_bag(player, out)
  read_asi_storage(out)
  return out
end

-- --- capture ----------------------------------------------------------------
-- All carried wands (M1-T2). EZWand has no enumeration helper, so walk the player's
-- quick-inventory and keep the wands. `slot` is the STABLE child order (0..3) so the
-- app's panels don't reorder when you switch wands; `active` marks the currently-held
-- wand (Inventory2Component.mActiveItem, via EZWand.GetHeldWand). NOTE: a wand's spell
-- positions can be unreliable until its inventory has been opened in-game once.
local function read_all_wands(player)
  local out = json.array({})
  local inv = nil
  for _, c in ipairs(EntityGetAllChildren(player) or {}) do
    if EntityGetName(c) == "inventory_quick" then
      inv = c
      break
    end
  end
  if not inv then return out end

  local held = EZWand.GetHeldWand() -- nil/false if not holding a wand
  local held_id = held and held.entity_id or nil

  local slot = 0
  for _, child in ipairs(EntityGetAllChildren(inv) or {}) do
    if EZWand.IsWand(child) then
      local w = read_wand(EZWand(child), slot)
      w.active = (held_id ~= nil and child == held_id)
      out[#out + 1] = w
      slot = slot + 1
    end
  end
  return out
end

-- Build the schema-shaped snapshot (all wands + spell bag + perks), or nil if no
-- player yet. NO timestamp here: it is stamped at write time, so a changing frame
-- number doesn't defeat the emit-on-change check. (Nearby shop/pedestal/Holy-Mountain
-- = M1-T6 — the next additive slice.)
local function build_snapshot()
  -- Re-fetch when the cached handle is nil OR DEAD. After a death/respawn (e.g. the
  -- quant.ew co-op respawn) OnPlayerSpawned may not re-fire, leaving a stale dead
  -- entity that reads no inventory_quick -> 0 wands forever. EntityGetIsAlive(dead)
  -- is false, so this refreshes to the live player.
  if not player_entity or not EntityGetIsAlive(player_entity) then
    player_entity = EntityGetWithTag("player_unit")[1]
  end
  local player = player_entity
  if not player then return nil end

  return {
    schema = 1,
    run_id = run_id,
    player = { perks = read_perks() },
    wands = read_all_wands(player),
    spell_inventory = read_spell_bag(player),
  }
end

-- Stamp + encode + (over)write snapshot.json — the single live file the bridge watches.
local function write_snapshot(snap)
  snap.timestamp = GameGetFrameNum()
  return write_file("snapshot.json", json.encode(snap))
end

-- --- DB dumps ---------------------------------------------------------------
-- Deep-copy a Lua value into a JSON-safe one, dropping functions (the `action`
-- closures on spells, `func` on perks) and capping recursion depth.
local function sanitize(value, depth)
  local t = type(value)
  if t == "function" or t == "userdata" or t == "thread" then return nil end
  if t ~= "table" then return value end
  if depth > 6 then return nil end
  -- Array vs object: any string key => object; otherwise (only integer keys, or
  -- empty) => array, so an empty game list encodes as [] not {} (the DB schemas
  -- require arrays for list fields like related_projectiles).
  local has_string_key = false
  for k in pairs(value) do
    if type(k) == "string" then
      has_string_key = true
      break
    end
  end
  if has_string_key then
    local obj = {}
    for k, v2 in pairs(value) do
      if type(k) == "string" then
        local sv = sanitize(v2, depth + 1)
        if sv ~= nil then obj[k] = sv end
      end
    end
    return obj
  end
  local arr = json.array({})
  for i = 1, #value do arr[i] = sanitize(value[i], depth + 1) end
  return arr
end

local function dump_databases()
  -- Spell DB: load via gun.lua (sets up `actions` + helper env, as WandDBG does);
  -- fall back to gun_actions.lua, which defines the `actions` table directly.
  if actions == nil then dofile("data/scripts/gun/gun.lua") end
  if actions == nil then dofile("data/scripts/gun/gun_actions.lua") end
  local spells = json.array({})
  if actions then
    for _, a in ipairs(actions) do spells[#spells + 1] = sanitize(a, 0) end
  end
  local ok1 = write_file("wand_capture_spell_db.json", json.encode(spells))

  -- Perk DB: global `perk_list`.
  ensure_perk_list()
  local perks = json.array({})
  if perk_list then
    for _, p in ipairs(perk_list) do perks[#perks + 1] = sanitize(p, 0) end
  end
  local ok2 = write_file("wand_capture_perk_db.json", json.encode(perks))

  GamePrint("[wand_capture] DB dump: spells=" .. #spells .. " (ok=" .. tostring(ok1) ..
    "), perks=" .. #perks .. " (ok=" .. tostring(ok2) .. ")")
  print("[wand_capture] DUMPED spell_db (" .. #spells .. " actions) + perk_db (" .. #perks .. " perks)")
end

-- --- mod callbacks ----------------------------------------------------------
function OnModPreInit() end
function OnModInit() end
function OnModPostInit() end
function OnWorldPreUpdate() end
function OnWorldInitialized() end

function OnPlayerSpawned(player)
  player_entity = player
  run_id = "run-" .. tostring(GameGetFrameNum()) -- placeholder; real seed at M1-T3
  last_emit = nil -- new run -> force the next emit
  GamePrint("[wand_capture] auto-syncing snapshot.json (wands + spells + perks). F8 = dump DBs.")
end

function OnWorldPostUpdate()
  -- F8 = dump the full spell + perk databases (the heavy, occasional export).
  -- Snapshot capture is AUTOMATIC below — no keypress needed for it.
  if InputIsKeyJustDown(65) then dump_databases() end

  -- Auto emit-on-change for the live bridge: every ~30 frames (~2x/sec), rebuild the
  -- snapshot (build_snapshot re-fetches the player handle itself, even after a respawn)
  -- and (over)write snapshot.json ONLY when the state actually changed (timestamp is
  -- stamped at write time, so it doesn't defeat the compare). The app updates on its own.
  if GameGetFrameNum() % 30 == 0 then
    local snap = build_snapshot()
    if snap then
      local key = json.encode(snap) -- no timestamp yet -> stable across idle frames
      if key ~= last_emit then
        last_emit = key
        write_snapshot(snap)
      end
    end
  end
end
