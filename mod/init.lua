-- =============================================================================
-- wand_capture - THROWAWAY M0 fixture-capture mod for the Noita wand assistant.
--
-- Responsibility: STATE EXTRACTION ONLY (no logic, no UI). On a hotkey it writes
-- a schema-shaped snapshot JSON (held wand + spell bag + acquired perks) and, on
-- another, dumps the spell + perk databases once.
--
-- THIS CODE CANNOT BE SELF-TESTED - it needs the running game. The human is the
-- test loop (see docs/capture-manual.md). Every API call here is grounded in
-- real source (EZWand, vanilla scripts, the official Lua API); points that could
-- not be fully verified from docs emit a diagnostic to logger.txt so the capture
-- doubles as an in-game probe. DO NOT assume this works until the human confirms.
--
-- Hotkeys:  F8 (scancode 65) = capture snapshot   F7 (scancode 64) = dump DBs
-- =============================================================================

local MODID = "wand_capture"
local EZWand = dofile_once("mods/" .. MODID .. "/EZWand.lua")
local json = dofile_once("mods/" .. MODID .. "/json.lua")
local NULL = json.NULL

local player_entity = nil
local run_id = "run-unknown"
local snapshot_count = 0

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
-- The spell-bag entity is conventionally a player child named "inventory_full",
-- but that name is UNCONFIRMED in real mods - so log every player child name
-- (the human reports these to confirm the bag name for M1).
local function read_spell_bag(player)
  local out = json.array({})
  local children = EntityGetAllChildren(player) -- may be nil
  local bag = nil
  if children then
    for _, c in ipairs(children) do
      local name = EntityGetName(c)
      print("[wand_capture] player child: '" .. tostring(name) .. "' id=" .. tostring(c))
      if name == "inventory_full" then bag = c end
    end
  end
  if not bag then
    print("[wand_capture] NOTE: no child named 'inventory_full'; spell-bag name UNCONFIRMED (see child list)")
    return out
  end
  local items = EntityGetAllChildren(bag)
  if items then
    for _, item in ipairs(items) do
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
  return out
end

-- --- capture ----------------------------------------------------------------
local function capture_snapshot()
  if not player_entity then player_entity = EntityGetWithTag("player_unit")[1] end
  local player = player_entity
  if not player then
    GamePrint("[wand_capture] no player entity yet - spawn into a run first")
    return
  end

  local wands = json.array({})
  local held = EZWand.GetHeldWand() -- nil/false if not holding a wand
  if held then
    wands[1] = read_wand(held, 0) -- held wand = slot 0
  else
    print("[wand_capture] NOTE: not holding a wand (GetHeldWand returned nil/false)")
  end

  local snap = {
    schema = 1,
    run_id = run_id,
    timestamp = GameGetFrameNum(),
    player = { perks = read_perks() },
    wands = wands,
    spell_inventory = read_spell_bag(player),
  }

  snapshot_count = snapshot_count + 1
  local path = "wand_capture_snapshot_" .. snapshot_count .. ".json"
  local ok = write_file(path, json.encode(snap))
  if ok then
    GamePrint("[wand_capture] wrote " .. path .. "  (wands=" .. #wands ..
      ", perks=" .. #snap.player.perks .. ", bag=" .. #snap.spell_inventory .. ")")
    print("[wand_capture] WROTE " .. path ..
      " - locate it in the game working dir (install dir and/or Nolla_Games_Noita save dir) and report the full path")
  else
    GamePrint("[wand_capture] WRITE FAILED for " .. path .. " - io.open returned nil")
    print("[wand_capture] WRITE FAILED for " .. path ..
      " - confirm unsafe mods enabled + request_no_api_restrictions; the working dir may be read-only")
  end
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
  run_id = "run-" .. tostring(GameGetFrameNum()) -- placeholder; real seed at M1
  GamePrint("[wand_capture] ready: F8 = capture snapshot, F7 = dump spell/perk DBs")
  print("[wand_capture] OnPlayerSpawned player=" .. tostring(player) .. " run_id=" .. run_id)
end

function OnWorldPostUpdate()
  if InputIsKeyJustDown(65) then capture_snapshot() end -- F8
  if InputIsKeyJustDown(64) then dump_databases() end -- F7
end
