# Noita Live Wand Assistant — Design Spec v0.2

> Status: **finalized v0.2.** Core architecture locked; all §10 open items resolved via interview (2026-06-21) and recorded in the Decisions Log.

---

## 1. Vision

A tool that watches a live Noita run and helps the player build better wands on the fly. It always knows what wands and spells the player currently has (and has seen this run), simulates what any wand actually does, analyzes the player's current wands, and can generate strong builds from the spell pool available — surfaced first in a companion app, later as an in-game overlay.

### Goals
- **Live mirror** of current run state (held wands, spell inventory, **acquired + offered perks**, spells seen this run).
- **Accurate simulation** of any wand (cast sequence, projectiles, DPS, mana behavior) reusing an existing open-source engine.
- **Analysis** of the player's current wands ("this wand stalls on mana," "reorder these two for +40% DPS").
- **Generation** of strong builds from available spells, targeted at player-chosen archetypes.
- **Fast & responsive** — live updates feel instant and analysis/generation return at interactive speed; the tool re-ranks continuously as the run changes, never as a slow batch job.
- Built primarily by automated Claude Code, with the human acting only as the in-game test loop.

### Non-goals (for v1)
- Not a cheat tool (no auto-aim, no spawning items). Read-only relationship with the game.
- Not a seed analyzer / world-route planner (separate problem, existing tools cover it).
- Not multiplayer-aware.

---

## 2. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Live-data method | **Lua mod (Path A)** | Clean structured data, extensible, automatable to build. |
| Run purity | **Mod flagging is acceptable** | Player doesn't need achievements/streaks intact; removes all memory-reading complexity. |
| Primary surface | **External companion app**, overlay later | App is fully testable by Claude Code; overlay deferred to its own milestone. |
| Ambition | **Full stack**: mirror → simulate → analyze → generate | All four, delivered as escalating milestones. |
| Simulation | **Reuse**, don't rebuild | Noita's cast mechanics are solved open-source. |

---

## 3. Architecture

Two components plus a bridge. The guiding principle: **keep the untestable Lua piece tiny and dumb; put all logic in the app where automation is total.**

```
┌─────────────────────┐      JSON snapshot       ┌──────────────────────────┐
│   Noita + Lua mod   │  ───────────────────────▶ │     Companion app        │
│  (state extractor)  │   (ws://localhost or      │  (TypeScript / React)    │
│   ~thin, ~stable    │    watched JSON file)     │   all logic + UI here    │
└─────────────────────┘                           └──────────────────────────┘
        ▲                                                     │
        │ player plays normally                               │ later milestone
        │                                                     ▼
        └──────────────────────────────────  in-game overlay (deferred)
```

### 3.1 Component A — Noita extraction mod (Lua, "unsafe")

**Sole responsibility: read game state → emit a JSON snapshot whenever it changes. No analysis, no UI.**

Reads, via the ECS / EZWand:
- All wands the player holds (active + inventory slots): every wand stat (`shuffle`, `spellsPerCast`, `castDelay`, `rechargeTime`, `manaMax`, `mana`, `manaChargeSpeed`, `capacity`, `spread`, hidden `speedMultiplier`) plus the ordered spell slots (including always-cast spells) and empty slots.
- The player's loose **spell inventory** (the spell bag), read **compatibly with the Advanced Spell Inventory mod** (Steam Workshop `3267869519`), which changes how loose spells are stored — the exact storage entities are source-verified by reading the mod's own Lua at M1.
- The player's **acquired perks** (so the app can factor immunities/modifiers into self-danger and scoring).
- **World-visible items** the player can act on right now: shop spell/wand contents, pedestal wands, and **Holy-Mountain perk offerings**. Confirmed in scope (Decisions Log v0.2). *Sequencing:* landed as an **additive mod slice after** the core snapshot is proven in-game, to honor the thin-mod invariant — the first mod emits only held wands + spell inventory + acquired perks + the DB dumps.
- A one-time **database dump** from the *running game's own* data — `gun_actions.lua` (spells) **and `perk_list.lua` (perks)** — so the app's spell/perk stats match the player's exact game version **and any spell-adding mods** automatically.

Bridge options (pick at M1):
- **Watched JSON file** — mod writes `snapshot.json` to a known path via Lua `io`; app file-watches it. No native code, ~250ms latency. **Recommended default** (dead simple, robust).
- **Localhost websocket** — mod uses LuaJIT FFI + bundled `pollws.dll` to push over `ws://localhost:PORT`. Lower latency, but ships a native dll and is Windows-bound. Proven by `noita-ws-api` / Streamer Wands.

Constraints to respect:
- Noita has **no test harness**; this code is validated by the human running the game. Therefore keep it minimal and change it rarely.
- Avoid writing strings with quotation marks via the wrong API (a known `world_state.xml` corruption footgun) — we write our own file, not game saves, so this is avoided by construction.
- Emit on change only (diff against last snapshot) to avoid spamming I/O every frame.

### 3.2 Component B — Companion app (TypeScript)

Stack: **TypeScript + React + Vite** (matches the reusable simulator engines; fast for Claude Code to build and unit-test).

Modules:
1. **Ingestion** — read snapshot (file-watch or ws), validate against schema, hand to state store.
2. **Run-state store** — current wands + spell inventory; plus a **"seen this run" ledger** that accumulates every spell/wand observed (so the pool persists even after items leave the active view). Reset on new run (detected via run/seed change or world-init signal from the mod).
3. **Spell DB** — loaded from the mod's dump (canonical) with a vanilla fallback bundled.
4. **Simulator engine (reused)** — port/fork of salinecitrine's `noita-wand-simulator` or the MIT `awlego/noita-wand-visualizer`. Produces the cast tree, per-cast projectiles, and derived metrics. This is the source of truth for "what does this wand do."
5. **Analysis engine** — scores the player's *current* wands and proposes incremental fixes (reorder, swap one spell, remove a mana hog). Uses local search over the simulator.
6. **Generation engine** — given a spell pool + archetype + a wand chassis, searches for strong builds. (Hardest module; last milestone.)
7. **UI** — wand panels, live spell pool, simulator visualization, a "suggestions" feed, and a "build me a wand" action.

### 3.3 In-game overlay (deferred milestone)

Options to evaluate when we get there: in-game Lua GUI via `noita-dear-imgui`; a transparent always-on-top Tauri/Electron window rendering the same React app; or an OBS/browser-source style overlay. Decision deferred — the app must work standalone first.

---

## 4. Data model

### 4.1 Snapshot (mod → app), illustrative

```jsonc
{
  "schema": 1,
  "run_id": "seed-or-session-id",        // changes → app resets the run ledger
  "timestamp": 1234567,
  "player": {
    "mana_unused": false,                 // room for HP, gold later
    "perks": ["PERK_FIRE_IMMUNITY", "GLASS_CANNON"]   // acquired perks (ids from perk_list.lua)
  },
  "wands": [
    {
      "slot": 0,                          // inventory position; 0 = active
      "stats": {
        "shuffle": false, "spellsPerCast": 1, "castDelay": 6, "rechargeTime": 25,
        "manaMax": 500, "mana": 500, "manaChargeSpeed": 300,
        "capacity": 12, "spread": 4.0, "speedMultiplier": 1.0
      },
      "always_cast": ["ADD_TRIGGER"],
      "spells": ["DAMAGE", "DOUBLE_SPELL", "SPELL_X", null, "BLACK_HOLE", ...] // null = empty
    }
  ],
  "spell_inventory": ["LIGHT_BULLET", "BOUNCE", "..."],   // loose spells in the bag (Advanced-Spell-Inventory-aware)
  "world_seen": {                          // items the player can act on right now (additive mod slice)
    "shop_spells": [], "pedestal_wands": [],
    "perk_offerings": ["PROJECTILE_REPULSION", "VAMPIRISM"]  // perks on offer in the current Holy Mountain
  }
}
```

### 4.2 Spell DB entry (dumped from game), illustrative

```jsonc
{
  "id": "BLACK_HOLE",
  "name": "Black Hole",
  "type": "PROJECTILE",                  // PROJECTILE | STATIC | MODIFIER | MULTICAST | MATERIAL | UTILITY | PASSIVE | OTHER
  "mana": 240,                           // mana drain
  "max_uses": 5,                         // -1 = unlimited
  "deck_modifier": { /* cast-state deltas if it's a modifier/multicast */ },
  "projectile": { "damage": {...}, "speed": ..., "lifetime": ..., "homing": false, "explosion_radius": ... },
  "spawn": { "level": [...], "probability": ... },   // optional, for "where to find" hints
  "unlock_required": false
}
```

### 4.3 Perk DB entry (dumped from game), illustrative

```jsonc
{
  "id": "PERK_FIRE_IMMUNITY",
  "name": "Fire Immunity",
  "effects": { "immunities": ["FIRE"], "modifiers": {} },  // parsed flags the scorer uses
  "stackable": false,
  "max_in_pool": 1
}
```

Perks feed the analysis/generation model directly: immunities (`FIRE`/`TOXIC`/`EXPLOSION`/…) flip the **self-danger** verdict; stat modifiers adjust damage/utility scoring. Exact parseable fields are confirmed against the real `perk_list.lua` in M3/M4 (flagged, not assumed).

Neither DB is hand-maintained; both regenerate from the player's game. Vanilla spell + perk snapshots are bundled only as fallback.

---

## 5. Wand mechanics model (reference, not to re-derive)

The reused engine is the source of truth. Captured here so we can validate it and ground the analysis/generation scoring.

**Wand stats** (above). Two timing values matter most: `castDelay` (between casts within a charge) and `rechargeTime` (refilling the deck after it empties).

**Cast loop (deck → hand → discard).** The wand draws spells from its deck in slot order into a "hand," accumulating **modifiers** onto the next projectile(s), expanding **multicast** spells (Double/Triple Cast draw N to fire together), and resolving **triggers/timers** (a trigger projectile casts the *next* deck spell(s) as a payload on impact/timer/death). When the deck empties mid- or post-cast, non-shuffle wands **wrap** and continue (the basis of many advanced builds), then **recharge** fires. **Shuffle** wands randomize draw order each recharge cycle, breaking ordered combos (triggers/timers/formations become unreliable).

**Always-cast** spells fire with *every* shot regardless of the deck, and don't consume mana per the usual rules in the same way (engine-specific; defer to reused engine).

**Mana.** Every spell has a mana drain; the wand needs enough mana to fire the cast. Mana regenerates at `manaChargeSpeed`. A wand that drains more per recharge-cycle than it can regen **stalls** — a key (often invisible) quality signal.

**Edge cases where engines disagree** (test these against the real game when validating): wrapping interactions with multicast, trigger payload draw counts, recursive spells (e.g. Divide By, recursive reflection), per-cast vs per-projectile modifier application, and unlimited vs `max_uses`-limited spells. The reused engine's handling is authoritative; our job is to confirm it matches the player's game version.

---

## 6. The "good wand" model (the ambitious part)

"Optimal" is situational, so the engine optimizes toward a **chosen archetype** over a **defined pool**, and reports rich metrics rather than a single score.

### 6.1 Metrics computed from simulation
- Sustained DPS (accounting for castDelay + rechargeTime + mana stalls), and burst DPS.
- Mana sustainability (can it fire continuously, or does it stall? after how many seconds?).
- Projectiles/sec, spread/accuracy, homing present?, AoE/explosion radius, effective range, pierce/bounce.
- Utility flags: digging power, defensive value, mobility.
- **Self-danger** (very Noita-specific): does the build set the player on fire, explode in their face, leak toxic/lava, or recoil dangerously? A naive optimizer ignores this; ours flags it — **and evaluates it relative to the player's acquired perks** (immunities can fully neutralize a hazard, turning a "self-kill" build into a safe one). A **first-class veto**, not a soft penalty.

### 6.2 Archetypes (confirmed — all of these matter)
Max single-target DPS · Mana-efficient spammer · Crowd/horde clear (AoE) · **Utility/mobility** (digging **and** movement: teleport/blink/levitation) · Defensive/utility · "Just rank my current wands as-is." The scorer is **archetype-parameterized** and reports rich per-archetype metrics — never one collapsed score.

**Output = a tier list (S/A/B/C) _per archetype_** (confirmed 2026-06-21), **not** a single "best wand." Each archetype's list ranks **both** the player's currently-held wands **and** builds the generator proposes from the pool, with every tiered entry carrying its key metrics + a self-danger flag. (UI is M4/M5.)

### 6.3 Inputs to generation
- **Pool** (confirmed): **owned + seen-in-world by default** — what the player owns (incl. spells held earlier this run) plus spells/wands/perks visible in shops, pedestals, and Holy-Mountain offerings, yielding actionable *"go grab X"* advice. **Full-DB theorycraft is a toggle** on top.
- **Perks** (confirmed): acquired perks are an input to scoring/safety; offered perks are candidates the generator can recommend taking ("pick Projectile Repulsion to make this build safe").
- **Chassis**: a real wand the player owns (its capacity/shuffle/base stats constrain what's buildable), or an idealized chassis for theorycraft.
- **Archetype** + any constraints (e.g. "must dig," "no self-damage").

### 6.4 Search strategy (escalating, because ordering × capacity explodes combinatorially)
1. **Rank** existing wands (pure simulation + scoring) — cheap, ship first.
2. **Local search** for incremental fixes: single swaps, reorders, removals, evaluated via the simulator (beam/hill-climb). Powers the "suggestions" feed.
3. **Template-seeded generation**: detect key spells in the pool (a nuke, a trigger, a multicast) and instantiate known-good patterns (trigger→payload, multicast stack, spammer, single-nuke), then local-search to polish. This is the "build me a wand" feature and the last/hardest module.

**Performance is a requirement, not an afterthought** (confirmed 2026-06-21): simulation + scoring must be fast enough that the tier list re-ranks at interactive speed as the run changes. Keep search within a bounded/interactive budget (heuristics + templates + local search, never brute force); push heavy search off the UI thread (e.g. a web worker) and reuse cached sim results so live updates stay responsive.

### 6.5 Output & guidance model — the tunable "assistant dial" (confirmed 2026-06-22)

The tool is an **assistant/guide first**, an optimizer second: by default it helps the player get *better*, with full "do this exactly" prescription available on demand. Output intensity is a **single tunable dial** with four rungs — and **teaching is richest at the low end and fades as prescription rises** (gentle hints carry the deep *why*; exact builds are terse):

1. **Mirror** — show the player's wands + what they do (metrics, cast tree). No advice. *(Shipped: M2/M3.)*
2. **Teach** — hints + "go experiment" nudges carrying the **most explanation**: the mechanic *why* ("this wand has spare capacity and a trigger — a trigger fires a second spell on impact, so try a payload right after it"). Discovery-oriented; builds player skill.
3. **Suggest** — ranked, concrete incremental options with a one-line why ("swap Spark → Black Hole: +12 AoE, removes the fire self-danger"). *(Shipped: M4 suggestions feed.)*
4. **Prescribe** — the exact build, terse, with **provenance**: "Add Trigger ▸ slot 1 · Chainsaw *[your bag]* ▸ slot 2 · Luminous Drill *[shop, west]* ▸ slot 3." The full "DO THIS" mode.

**Control:** a **global default level** sets the tone, and **any individual card can drill down** ("tell me exactly") or collapse ("just a hint") on demand — all on the one page, no pagination. Default posture = guide (Teach/Suggest); Prescribe is opt-in.

**Architectural principle — the dial is a presentation layer, not a second engine.** The simulator + analysis **always compute the exact best build *and* its reasoning**; the dial only decides **how much to reveal and how to phrase it** (a nudge vs a command) over that same computation. Every rung reuses the same M3 simulator + M4 analysis + M5 generation — the dial adds *framing and verbosity*, never a parallel code path.

**Prescribe needs provenance.** "From your bag / grab the one in the shop" requires knowing each pooled item's **origin**. Decision: the run-state ledger **tracks per-item provenance** (owned / shop / pedestal / Holy-Mountain), accumulated across the run, so an item seen in a shop earlier stays "go-grab-able" with its source. Testable now with synthetic `world_seen`; validated end-to-end once the M1 world-scan slice captures real shop/pedestal/Holy-Mountain contents.

---

## 7. Build plan (milestones for Claude Code)

Designed so each milestone is independently testable, and so app development needs the game **only twice** (to capture fixtures).

- **M0 — Fixtures & schema.** Define the snapshot + spell-DB schemas. *Human runs the game once* to capture 5–10 real snapshots (various wands) + one spell-DB dump. These become test fixtures so the entire app is then buildable with **zero game access.**
- **M1 — Extraction mod + bridge.** Thin Lua mod that reads state and writes `snapshot.json` (+ dumps the spell DB once). *Human validates in-game.* Smallest possible surface.
- **M2 — Ingestion + run-state store + live mirror UI.** App reads fixtures/live snapshot, shows current wands + live spell pool + "seen this run" ledger. Fully unit-tested against fixtures.
- **M3 — Simulator integration.** Port/fork the reused engine; render the cast tree + per-wand metrics. Validate engine output against the real game on a few known wands (*light human spot-check*).
- **M4 — Analysis engine.** Score current wands; suggest reorders/swaps/removals via local search. Detect mana stalls and self-danger.
- **M5 — Generation engine.** Archetype-targeted build generation (rank → local search → templates).
- **M6 — In-game overlay.** Choose overlay tech; render the same app over/in the game.

### Testing strategy
- **App: 100% automated.** Everything runs against recorded fixtures + unit tests; Claude Code builds and verifies without the game.
- **Mod: human-in-the-loop.** The only piece needing the game. Kept tiny on purpose. Loop = Claude Code writes Lua → human runs Noita → pastes `logger.txt` / the emitted JSON back → iterate.
- Engine validation: a small fixture set of wands with known in-game behavior, compared against simulator output.

---

## 8. Reusable prior art (don't reinvent)
- **salinecitrine/noita-wand-simulator** — simulator that parses `gun_actions.lua`; most accurate; engine candidate.
- **awlego/noita-wand-visualizer** — MIT-licensed React/TS engine; clean code; engine candidate.
- **Streamer Wands (Noita-Community/streamer-wands-backend)** — proven live game→external export over websocket.
- **probable-basilisk/noita-ws-api** — canonical FFI+pollws localhost websocket bridge.
- **TheHorscht/EZWand** — Lua wand read/write library (exposes all wand stats).
- **necauqua/noita-utility-box** — memory-reading reference (only relevant if we ever revisit Path B).

---

## 9. Risks & mitigations
- **Game updates break the mod / engine.** Mitigation: thin mod; spell DB dumped from the live game each run; engine validated against fixtures per game version.
- **Simulation inaccuracy on edge cases.** Mitigation: lean on a maintained engine; keep a regression fixture set of tricky wands.
- **Combinatorial blow-up in generation.** Mitigation: heuristics + templates + local search, never brute force; cap search budget.
- **"100% automated" expectation vs. the in-game test reality.** Mitigation: architecture concentrates all untestable code into a tiny, rarely-changed mod; human loop is minimized and explicit.

---

## 10. Resolved items (✅ — finalized via interview 2026-06-21)
1. **Platform/setup.** ✅ **Cross-platform required.** Maintainer runs **Linux + Proton**; co-player runs **Windows + Steam**; each runs an independent local instance (not networked). File-watch bridge is the default (pure Lua `io`, works on both); the websocket bridge stays a Windows-only optional (depends on `pollws.dll`). Game-install and snapshot paths are auto-detected/configurable per OS, never hardcoded. A separately-packaged native build per OS is acceptable.
2. **Pool for suggestions.** ✅ **Owned + seen-in-world** by default (with "go grab X" advice for shops/pedestals/perk offerings); **full-DB theorycraft as a toggle**. World-scanning lands as a *separate additive mod slice* after the core snapshot is proven, to keep the first mod thin.
3. **Archetypes & judgment.** ✅ **All** archetypes matter (incl. utility/mobility = digging **and** movement). Scorer is archetype-parameterized with rich per-archetype metrics; **self-danger is a first-class veto, evaluated relative to acquired perks**.
4. **Spoiler tolerance.** ✅ **Full info, no gating** — surface every spell/perk including secret/endgame content.
5. **Mods.** ✅ **Vanilla spell set now, mod-safe by construction.** M0 fixtures are vanilla; the DB-dump design already handles modded spells/perks. **Explicit compatibility target: the Advanced Spell Inventory mod** (Steam Workshop `3267869519`) — a QoL inventory mod (not spell-adding) that the maintainer runs; the extraction mod must read the spell bag compatibly with it (storage entities source-verified at M1). Modded *mechanics* the reused engine can't verify are flagged "approximate." Revisit broader modded fixtures only if spell-adding mods are added later.
6. **Perks (added during interview).** ✅ Tool **mirrors acquired + offered perks**, **feeds acquired perks into scoring/self-danger**, and **advises which offered perk best helps a build**. Perk definitions dumped from the game's own `perk_list.lua` (same philosophy as the spell DB). Perk-offering scanning is part of the additive world-scan slice.

---

## Decisions Log
- v0.1: Path A (Lua mod) chosen; mod flagging accepted; app-first with deferred overlay; full ambition (mirror/simulate/analyze/generate); reuse simulator engine; file-watch bridge as default.
- v0.2 (2026-06-21, interview): **Cross-platform** (Linux/Proton maintainer + Windows co-player, independent local instances) — reinforces file-watch as default bridge, websocket stays Windows-only optional, paths auto-detected per OS. **Pool** = owned + seen-in-world default, theorycraft toggle; world-scan is an additive post-core mod slice. **Archetypes** = all (incl. utility/mobility = dig + movement); archetype-parameterized scoring; **self-danger a first-class veto evaluated relative to perks**. **Spoilers** = full info. **Mods** = vanilla now, mod-safe; M0 fixtures vanilla; **explicit compat target = Advanced Spell Inventory mod (3267869519)**. **Perks (new scope)** = mirror acquired+offered, feed acquired into scoring/safety, advise on offered picks; perk DB dumped from `perk_list.lua`. **Tooling directive** = use Context7 for all library/framework docs throughout; keep to the latest stable, best-in-class TS stack (validated at scaffold time).
- v0.2.1 (2026-06-21, vision refinements): **Output = tier list per archetype** (S/A/B/C), ranking **both held wands and generated builds** — not a single "best." **Pool confirmed = owned + seen-in-world** (read-only; never scans the unexplored map; a stricter owned-only mode is available as a setting). **Performance = explicit requirement**: fast/responsive sim so the tier list re-ranks at interactive speed (bounded search, heavy work off the UI thread, cached sims). Context: M0 complete — fixtures + schemas validated against real captures.
- v0.2.2 (2026-06-22, post-M4 vision refinement): **Output is a tunable "assistant dial," not just a ranked list** (new §6.5). Four rungs — **Mirror → Teach → Suggest → Prescribe** — where teaching/explanation is **richest at the low end and fades toward terse exact builds**; controlled by a **global default + per-card drill-down** on the one page. Default posture = assistant/guide; full Prescribe is **opt-in**. The dial is a **presentation layer over the same simulator + analysis engine** (the engine always computes the exact build + reasoning; the dial governs reveal + framing) — reuses M3/M4/M5, never forks the engine. The **Prescribe rung consumes per-item provenance**, so the run-state ledger will **track each pooled spell/wand/perk's origin** (owned / shop / pedestal / Holy-Mountain), accumulated across the run; synthetic-testable now, validated end-to-end after the M1 world-scan slice. Rung mapping: Mirror = M2/M3 ✅, Suggest = M4 ✅; **Teach + Prescribe + the dial + provenance = M5-era**. Context: M4 complete (analysis engine + per-archetype tier list).
