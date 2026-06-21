# Implementation Plan: Noita Live Wand Assistant

> Derived from `noita-wand-assistant-spec.md` v0.2 and `CLAUDE.md`. Grounded in three
> source-verified research passes (engine, TS stack via Context7, Noita modding API).
> **Status: awaiting human review before any build (Job 3 → Job 4 gate).**

## Overview

Two components: a deliberately thin **Noita Lua extraction mod** (state → `snapshot.json`)
and a **TypeScript/React/Vite companion app** holding all logic + UI. The app is built and
verified **entirely against recorded fixtures**; the game is needed only to capture fixtures
(M0) and validate the mod (M1). Milestones escalate: mirror → simulate → analyze → generate
→ overlay.

## Legend — the test boundary (non-negotiable)

- **[APP]** — pure app/tooling. **Must** be proven with passing Vitest tests (TDD red→green)
  and, for UI, browser-verified. I can complete these end-to-end with zero game access.
- **[MOD]** — touches the Lua mod or otherwise needs the running game. **I cannot self-test
  these.** I implement, then STOP and hand you a copy-paste manual test script + exactly which
  `logger.txt` lines / JSON to paste back. Never marked done without your confirmation.

Task sizes: **XS** 1 file · **S** 1–2 · **M** 3–5 · **L** 5–8 (break down further if larger).

---

## Architecture decisions (with rationale + citations)

1. **Reused simulator engine = fork of `salinecitrine/noita-wand-simulator`'s `src/app/calc/`.**
   Its `gun.ts` is a faithful line-by-line port of Noita's own `gun.lua`
   (`shuffle_deck_when_empty`, `draw_actions`, `actions_per_round`, `move_discarded_to_deck`,
   `StartReload`, `action_mana_required`); `eval/clickWand.ts` adds mana drain + trigger/timer
   handling. The sim core is framework-agnostic TS, cleanly separable from its CRA/React-17/Redux
   UI — we port **only `calc/`**.
   - **Licensing (accepted):** repo ships **no LICENSE** (= all-rights-reserved). Decision
     (2026-06-21): acceptable for this **personal, non-distributed** project. **Caveat:** if we
     ever publish/distribute, first obtain an explicit license grant from `salinecitrine`.
   - **Runtime-data reconciliation (key M3 task):** the engine consumes **build-time** Python-
     generated action tables (`scripts/generate_gun_actions.py` → `src/app/calc/__generated__`),
     but our mod dumps the player's `gun_actions.lua` at **runtime**. M3 must bridge these (adapt
     the engine to ingest our runtime spell-DB dump, with a generated baseline as fallback).

2. **Stack (latest stable, Context7-verified 2026-06-21; exact patches via npm).**
   | Tool | Version | Why |
   |---|---|---|
   | Vite | 8.0.16 | Rolldown/Oxc; fastest builds. `react-ts` template. |
   | React | 19.2.7 | Current stable; no special config with Vite. |
   | TypeScript | 6.0.x | Latest stable. **Do not use TS 7** (Go-native, still RC). |
   | Vitest | 4.1.x | Adds Vite 8 support; reuses installed Vite. Node ≥20. |
   | Valibot | 1.4.x | Schema validation for untrusted JSON; ~10× smaller + faster init than Zod; Standard-Schema compliant (swappable). |
   | chokidar | 5.0.x | Cross-platform file-watch for the bridge. **ESM-only, Node ≥20.19.** |
   | Tauri | v2 (CLI 2.11.x) | Cross-platform packaging **and** the M6 transparent click-through overlay (`setIgnoreCursorEvents`). Needs Rust + WebView2/WebKitGTK. |
   | Zustand | 5.0.x | Lightweight store for live run-state. |

3. **Repo structure = single Vite `react-ts` app** (not a monorepo — simpler for a personal
   project). Framework-agnostic logic lives in `src/` subdirs and is imported by both tests and
   UI:
   ```
   src/schema/      Valibot schemas + inferred types (snapshot, spell-DB, perk-DB)
   src/engine/      ported salinecitrine calc/ (sim core)
   src/analysis/    scoring, self-danger, local search (M4)
   src/generation/  template-seeded build search (M5)
   src/store/       Zustand run-state + "seen this run" ledger
   src/ui/          React components
   src/data/fixtures/   recorded JSON fixtures (the app's test backbone)
   src/data/vanilla/    bundled vanilla spell+perk DB fallback
   mod/             the Noita Lua extraction mod (M1) — NOT bundled into the app
   bridge/          tiny Node chokidar→WebSocket sidecar for live mode (flagged)
   src-tauri/       Tauri shell (M6)
   ```

4. **The app is fixture-driven; live data is flagged.** M2–M5 develop against imported fixture
   JSON — **no bridge needed**. A small **Node chokidar→WebSocket sidecar** (`bridge/`) provides
   live mode behind a `VITE_LIVE=1` flag; fixtures remain the default and the app must always run
   without the bridge. At M6 the bridge folds into the Tauri shell. *(Confirm at review — see Open
   Questions.)*

5. **Cross-platform paths are computed, never hardcoded.** Snapshot is written by the mod into
   the `Nolla_Games_Noita` save dir (portable: same on both OSes, just wrapped by the Proton
   prefix on Linux). The bridge locates it by parsing `steamapps/libraryfolders.vdf` (AppID
   **881100**) and checking `compatdata/881100/pfx/drive_c/users/steamuser/AppData/LocalLow/...`
   on Linux vs `%USERPROFILE%/AppData/LocalLow/...` on Windows.

---

## Dependency graph (bottom-up)

```
M0 scaffold + schemas ──┬─► M1 mod (emits schema-shaped JSON)  [MOD]
                        │
                        ├─► M2 ingestion + store + mirror UI    [APP, on fixtures]
                        │        │
                        │        └─► (live bridge sidecar, flagged)
                        │
                        └─► M3 engine port + metrics ─► M4 analysis ─► M5 generation
                                                              │
                                                              └─► M6 overlay (Tauri)
```
M1 and M2 both depend only on M0's schema and can proceed in parallel (M1 human-loop, M2 app).
M3→M4→M5 is a strict chain (each consumes the prior). M6 is last.

---

## M0 — Fixtures & schema  *(this is Job 4 — built after you approve this plan)*

Goal: a scaffolded, tested TS project with the JSON **schemas**, plus a **manual capture script**
so you can record real fixtures. Ends by STOPPING for you to capture (M0 needs you as the loop).

### M0-T1 [APP] Scaffold the project — *S*
- **Description:** `npm create vite@latest` (`react-ts`); add Vitest, Valibot; configure
  `vitest` + a `typecheck` script; commit a green "hello test".
- **Acceptance:** `npm run build`, `npm test`, `npm run typecheck` all succeed on a trivial test.
- **Verify:** `npm test` shows 1 passing; `npm run build` exits 0.
- **Deps:** none. **Files:** `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `src/smoke.test.ts`.

### M0-T2 [APP] Snapshot schema (Valibot) + inferred types — *M*
- **Description:** Encode the spec §4.1 snapshot in Valibot: `schema` version, `run_id`,
  `frame`/`timestamp`, `player.perks[]` (`{id, stacks}`), `wands[]` (all stats per the EZWand
  mapping — see M1-T2; time stats in **frames**; note raw vs UI `capacity`), `wands[].spells[]`
  (ordered, `null` = empty slot), `wands[].always_cast[]`, `spell_inventory[]`
  (`{action_id, uses_remaining}`), and optional `world_seen{shop_spells, pedestal_wands,
  perk_offerings}`. Export inferred TS types.
- **Acceptance:** a hand-written valid sample parses; 3 malformed samples (missing stat, bad
  enum, wrong type) are rejected with field-level errors.
- **Verify:** `npm test -- snapshot` green (red→green).
- **Deps:** M0-T1. **Files:** `src/schema/snapshot.ts`, `src/schema/snapshot.test.ts`.

### M0-T3 [APP] Spell-DB + Perk-DB schemas (Valibot) — *M*
- **Description:** Encode spec §4.2/§4.3. Spell entry from `gun_actions.lua` fields
  (`id`, `name` (loc key), `type` ACTION_TYPE_* enum, `mana`, `max_uses`, `spawn_level`,
  `spawn_probability`, `price`, optional `deck_modifier`/`projectile`). Perk entry from
  `perk_list.lua` (`id`, `ui_name`, `ui_description`, `stackable`, `max_in_pool`, parsed
  `effects.immunities[]`/`modifiers`).
- **Acceptance:** valid samples parse; malformed rejected; `type`/immunity enums enforced.
- **Verify:** `npm test -- db-schema` green.
- **Deps:** M0-T1. **Files:** `src/schema/spell-db.ts`, `src/schema/perk-db.ts`, `*.test.ts`.

### M0-T4 [MOD] Minimal one-shot capture mod + manual test script — *M*
- **Description:** Write a **throwaway, minimal** Noita mod (`mod/` seed) that, on a hotkey,
  dumps the **current** state (held wand + spell bag + acquired perks) to `snapshot.json` and
  dumps the spell+perk DBs once — grounded in the M1 research (EZWand `GetHeldWand/GetProperties/
  GetSpells`; `inventory_full` children via `EntityGetFirstComponentIncludingDisabled`;
  `GameHasFlagRun("PERK_PICKED_"..id)`; `dofile_once` the two DB files; `io.open` under
  `request_no_api_restrictions="1"`). Plus a **copy-paste manual test script**: install location,
  enabling unsafe mods, what to do for 5–10 varied wands (shuffle/non-shuffle, multicast, trigger,
  mana-hog, always-cast), and exactly which files/`logger.txt` lines to paste back.
- **Acceptance (human-loop):** you run it and paste back 5–10 `snapshot.json` captures + one
  `spell_db.json` + one `perk_db.json`. *I cannot verify this myself.*
- **Verify:** **STOP.** You confirm the files were produced and paste them.
- **Deps:** M0-T2, M0-T3 (schema defines the emit shape). **Files:** `mod/init.lua`, `mod/mod.xml`, `docs/capture-manual.md`.

### M0-T5 [APP] Freeze fixtures + validate against schema — *S*
- **Description:** Commit the pasted captures under `src/data/fixtures/`; add a test that parses
  **every** fixture through the schemas. Any failure → fix the schema (real data is the source of
  truth) and note the correction.
- **Acceptance:** all recorded fixtures parse; ≥1 fixture per important shape (shuffle, multicast,
  trigger, always-cast, full bag, perks present).
- **Verify:** `npm test -- fixtures` green over all recorded files.
- **Deps:** M0-T4. **Files:** `src/data/fixtures/*.json`, `src/data/fixtures.test.ts`.

### ✅ Checkpoint M0
- Schemas exist and are tested; real fixtures parse; capture loop proven. **App is now buildable
  with zero further game access through M5.** Review before M1/M2.

---

## M1 — Extraction mod + bridge  *(all [MOD] — human-in-the-loop; built thin, changed rarely)*

Goal: evolve the M0 capture seed into the real product mod (robust, emit-on-change) and wire the
live bridge. **Sequenced thin-first:** core snapshot proven before any world-scanning is added.

> Every M1 task carries the relevant items from the **12-point in-game verification checklist**
> (appended at the end of this plan) as its acceptance criteria. These are the things docs could
> not fully confirm and only you can verify in-game.

### M1-T1 [MOD] Core snapshot, emit-on-change — *M*
- **Description:** `OnPlayerSpawned` captures the player handle + resets the run cache + sets
  `run_id`; `OnWorldPostUpdate` throttles via `GameGetFrameNum() % N`, builds the snapshot, and
  writes only when it differs from the last emit. Held wand + stats via EZWand; spell bag via the
  vanilla `inventory_full` recipe.
- **Acceptance (human-loop):** held wand stats + ordered spells + spell bag match the in-game UI
  across several wands; file rewrites only on change (verify checklist items 1–5, 9, 11).
- **Verify:** STOP + manual script; you paste `snapshot.json` + `logger.txt`.
- **Deps:** M0 complete. **Files:** `mod/init.lua`, `mod/*.lua`.

### M1-T2 [MOD] Inventory-slot wands + raw/UI capacity + always-cast ordering — *M*
- **Description:** Enumerate equipped/holstered wands (EZWand has no helper — iterate
  `inventory_quick` children, filter `EZWand.IsWand`, wrap). Resolve raw vs UI `deck_capacity`
  and confirm empty-slot rendering + always-cast separation.
- **Acceptance (human-loop):** all carried wands appear with correct slot index; empty slots
  represented; always-cast separated (checklist 1–3).
- **Verify:** STOP + manual script.
- **Deps:** M1-T1.

### M1-T3 [MOD] Acquired perks + DB dumps hardening — *S*
- **Description:** Enumerate perks by testing `PERK_PICKED_<id>` flags over the dumped
  `perk_list`; include stack counts (`..._PICKUP_COUNT` Globals). Confirm `dofile_once` cache
  behavior for clean DB dumps; resolve loc-key names via `GameTextGet`.
- **Acceptance (human-loop):** acquired perks (with stacks) match the in-game perk bar; DB dumps
  stable across reloads (checklist 8).
- **Verify:** STOP + manual script.
- **Deps:** M1-T1.

### M1-T4 [MOD] Advanced Spell Inventory compatibility — *S*
- **Description:** When that mod is present, also parse stored spells from
  `GlobalsGetValue("AdvancedSpellInventory_stored_spells","")` (`stack;action_id;uses` per `|`).
  Re-read its current Lua to confirm key/format.
- **Acceptance (human-loop):** spells you moved into its storage appear in the snapshot
  (checklist 6).
- **Verify:** STOP + manual script (with that mod enabled).
- **Deps:** M1-T1.

### M1-T5 [APP] Live bridge sidecar (chokidar → WebSocket) — *S*
- **Description:** A ~30-line Node script: locate `snapshot.json` (libraryfolders.vdf / per-OS
  path), watch with chokidar, push contents over `ws://localhost`. App connects when `VITE_LIVE=1`;
  fixtures remain default. *(This one is [APP]-testable: feed it a temp file, assert WS emits.)*
- **Acceptance:** editing a temp JSON file emits a parsed WS message; app falls back to fixtures
  when the bridge is absent.
- **Verify:** `npm test -- bridge` green; manual: edit file, see WS message.
- **Deps:** M0-T2 (schema), M2-T1 (ingestion) ideally.

### M1-T6 [MOD] Additive world-scan slice — *M* *(deferred until core proven)*
- **Description:** Add `world_seen`: shop spells/wands, pedestal wands, and Holy-Mountain
  `perk_offerings` (entities tagged `perk` → `VariableStorageComponent name=="perk_id"`, filtered
  to the current mountain). Strictly additive to the snapshot.
- **Acceptance (human-loop):** shop/pedestal/perk-offer contents match what's on screen
  (checklist 7).
- **Verify:** STOP + manual script in a shop / Holy Mountain.
- **Deps:** M1-T1..T3 confirmed working first (thin-mod invariant).

### ✅ Checkpoint M1
- Core snapshot validated in-game; live bridge feeds the app; world-scan optional slice working.
  The mod is "done" and should now change rarely.

---

## M2 — Ingestion + run-state store + live mirror UI  *(all [APP], fixture-driven)*

### M2-T1 [APP] Ingestion + validate boundary — *S*
- **Desc:** Load a snapshot (fixture import or bridge WS), parse via Valibot, surface typed errors;
  reject malformed without crashing. **Acceptance:** valid fixtures load; malformed shows an error
  state, app stays up. **Verify:** `npm test -- ingestion`. **Deps:** M0.

### M2-T2 [APP] Zustand run-state store + "seen this run" ledger — *M*
- **Desc:** Current wands + spell inventory + perks; a ledger accumulating every spell/wand/perk
  observed; reset on `run_id` change. **Acceptance:** feeding a sequence of fixtures accumulates the
  ledger and resets on run change (pure unit tests). **Verify:** `npm test -- store`. **Deps:** M2-T1.

### M2-T3 [APP] Wand panel UI — *M*
- **Desc:** Render each wand: stats, ordered spell slots (with empties + always-cast), spell icons.
  **Acceptance:** renders all fixtures; matches stat values; browser-verified (DevTools, no console
  errors). **Verify:** `npm test` + browser check. **Deps:** M2-T2.

### M2-T4 [APP] Live spell pool + perks + ledger UI — *M*
- **Desc:** Spell bag, acquired perks, and the "seen this run" pool. **Acceptance:** reflects
  fixtures; updates as fixtures advance; browser-verified. **Verify:** tests + browser. **Deps:** M2-T2.

### ✅ Checkpoint M2
- App mirrors run state from fixtures end-to-end; optional live mode via bridge. Browser-verified,
  fully unit-tested.

---

## M3 — Simulator integration  *(mostly [APP]; one [MOD] spot-check)*

### M3-T1 [APP] Port `calc/` sim core — *L (break down on contact)*
- **Desc:** Vendor `salinecitrine/.../src/app/calc/**` into `src/engine/`, strip Redux/UI coupling,
  make it build under TS 6 / our config. Keep its tests if any. **Acceptance:** engine compiles;
  a known wand fixture produces a cast sequence without runtime errors. **Verify:** `npm test --
  engine`. **Deps:** M0, M2-T2. **Note:** record provenance + the licensing caveat in `src/engine/README`.

### M3-T2 [APP] Runtime spell-DB → engine adapter — *M*
- **Desc:** Resolve the build-time-vs-runtime mismatch: adapt the engine to ingest our dumped
  spell DB (fixture), with the vendored generated tables as fallback. **Acceptance:** engine runs
  off our `spell_db.json` fixture; falls back when absent. **Verify:** `npm test -- engine-data`.
  **Deps:** M3-T1, M0-T3.

### M3-T3 [APP] Metrics from simulation — *M*
- **Desc:** Derive spec §6.1 metrics (sustained/burst DPS, mana sustainability/stall time,
  projectiles/sec, spread, homing, AoE, range, pierce/bounce, utility flags). **Acceptance:** metrics
  computed for fixtures; mana-stall fixture flagged as stalling. **Verify:** `npm test -- metrics`.
  **Deps:** M3-T2.

### M3-T4 [APP] Cast-tree visualization — *M*
- **Desc:** Render the cast tree + per-cast projectiles + metrics in the UI. **Acceptance:** renders
  for fixtures; browser-verified. **Verify:** tests + browser. **Deps:** M3-T3, M2-T3.

### M3-T5 [MOD] Engine-accuracy spot-check — *S*
- **Desc:** Compare engine output vs real game on a few known wands. **Acceptance (human-loop):**
  outputs match within tolerance; mismatches logged as regression fixtures. **Verify:** STOP +
  manual comparison script. **Deps:** M3-T3.

### ✅ Checkpoint M3
- Simulator reproduces wand behavior from fixtures; spot-checked against the real game.

---

## M4 — Analysis engine  *(all [APP])* — *re-decompose at this checkpoint*

- **M4-T1 [APP]** Archetype-parameterized scoring over metrics (all archetypes incl.
  utility/mobility); rich per-archetype output, no single score.
- **M4-T2 [APP]** **Self-danger evaluator** as a first-class veto, evaluated **relative to acquired
  perks** (immunities neutralize matching hazards). Acceptance: a fire build is flagged dangerous
  without Fire Immunity, safe with it (fixture-driven).
- **M4-T3 [APP]** Local search (single swap/reorder/removal, beam/hill-climb over the simulator) →
  ranked incremental fixes.
- **M4-T4 [APP]** "Suggestions" feed UI; browser-verified.
- **Checkpoint M4:** current wands ranked per archetype; self-danger + perk interaction correct;
  suggestions proven on fixtures.

## M5 — Generation engine  *(all [APP])* — *re-decompose at this checkpoint*

- **M5-T1 [APP]** Pool assembly: owned + seen-in-world (default) with theorycraft (full-DB) toggle;
  "go grab X" provenance tags.
- **M5-T2 [APP]** Template detection (nuke / trigger / multicast / spammer) over the pool.
- **M5-T3 [APP]** Template-seeded generation + local-search polish, constrained by a real chassis +
  archetype + constraints (e.g. "must dig", "no self-damage"); **perk-pick advice** ("take
  Projectile Repulsion to make this build safe").
- **M5-T4 [APP]** "Build me a wand" UI; browser-verified.
- **Checkpoint M5:** generates archetype-targeted builds from the pool with perk-aware advice;
  search budget capped; proven on fixtures.

## M6 — In-game overlay  *(Tauri; [APP] build + [MOD] in-game verify)* — *re-decompose later*

- **M6-T1 [APP]** Wrap the app in **Tauri v2**; move the bridge into the shell; cross-platform
  packaged builds (AppImage/deb + NSIS) for Linux + Windows.
- **M6-T2 [APP]** Transparent, always-on-top, click-through overlay window
  (`setIgnoreCursorEvents`). Note: blur/`windowEffects` unsupported on Linux (transparency +
  click-through are).
- **M6-T3 [MOD]** In-game verification of the overlay over a live run.
- **Checkpoint M6:** same app renders as an overlay; packaged for both OSes.

---

## Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Engine build-time data vs our runtime dump | High | M3-T2 adapter; generated tables as fallback. |
| Engine edge-case correctness (34 open issues inherited) | Med | M3-T5 spot-check; regression fixtures for tricky wands. |
| Mod breaks on game update | Med | Thin mod; DBs dumped per run; engine validated per version. |
| `request_no_api_restrictions`/`io` disabled by a future patch | Med | Verify at M1 (checklist 12); fallback bridge = `ModTextFileSetContent` is **not** viable, so flag early. |
| Advanced Spell Inventory storage format changes | Low | Re-read its Lua at M1-T4; isolate behind one parser. |
| Tauri Rust toolchain friction | Low | Deferred to M6; M2–M5 are pure Vite. |
| Generation combinatorial blow-up | Med | Templates + local search + capped budget; never brute force. |

## Open questions — your nod at review makes Job 4 unblocked

1. **Bridge architecture:** small Node chokidar→WebSocket sidecar for live mode in M1-T5, folded
   into Tauri at M6 — good? (Alternative: defer *all* live data to M6.)
2. **Repo structure:** single Vite `react-ts` app with `src/` subdirs (not a monorepo) — good?
3. **M0 scaffolds the real app now** (react-ts), UI deferred to M2 — good? (Alt: barebones TS for M0.)
4. **Valibot** over Zod for schema validation (smaller/faster; swappable via Standard-Schema) — any
   preference for Zod?
5. **In-game verification checklist** (below) accepted as M1's human-loop acceptance criteria?

## Appendix — M1 "MUST VERIFY IN-GAME" checklist (human-loop checkpoints)

1. Inventory-slot wand enumeration (EZWand has no helper — `inventory_quick` children + `IsWand`).
2. EZWand `inventory_x` ordering reliability + empty-slot rendering (source comments it unfinished).
3. Raw vs UI `deck_capacity` (`wand.capacity` subtracts always-cast count).
4. Quick-slot held-spell layout vs wands.
5. `item_name`/`is_stackable`/`uses_remaining` actual values on spell cards.
6. Advanced Spell Inventory storage (Globals key + `stack;action_id;uses` format).
7. Holy-Mountain offered-perk isolation (the `perk` tag is generic — filter by altar proximity).
8. `dofile_once` cache state for clean DB dumps (may need plain `dofile` + global reset).
9. Runtime CWD for `io.open` (strongly inferred = `Nolla_Games_Noita` save dir; confirm both OSes).
10. Exact Linux Steam library root (parse `libraryfolders.vdf`; glob `users/*`).
11. `GameGetFrameNum` monotonic-counter semantics for throttling.
12. `request_no_api_restrictions` actually unlocks `io` in your installed game build.
