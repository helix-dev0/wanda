# Progress & status

> Living status doc. Companion to [`plan.md`](./plan.md) (the milestone breakdown) and
> [`../noita-wand-assistant-spec.md`](../noita-wand-assistant-spec.md) (the design).
> **Last updated: 2026-06-22** · branch `feat/m5-generation` (off `feat/m3-engine`; M0 merged to `master`).

## Milestone status

| Milestone | Status | Notes |
|---|---|---|
| **M0 — Fixtures & schema** | ✅ **COMPLETE** (T1–T5) | App is now buildable against fixtures with zero further game access through M5. |
| M1 — Extraction mod + bridge | ⬜ not started | Evolve the M0 capture seed into the real emit-on-change mod + live bridge. |
| **M2 — Ingestion + store + mirror UI** | ✅ **COMPLETE** (T1–T4) | First **visible** milestone — single-page wand-mirror dashboard, fixture-driven + browser-verified. |
| **M3 — Simulator integration** | ✅ **COMPLETE** (T1–T4) | Vendored `salinecitrine` `calc/`; sim layer + projectile-damage table + metrics + cast-tree UI. Fixture-driven + browser-verified. |
| **M4 — Analysis engine** | ✅ **COMPLETE** (T1–T4) | Archetype scoring + self-danger (perk-aware veto, separate **Unsafe** band) + depth-1 local search → **tier list per archetype** for held wands. Fixture-driven + browser-verified. |
| **M5 — Generation + dial + provenance** | ✅ **COMPLETE** (prelude, T1–T4) | Template-seeded + locally-polished builds merged into the per-archetype tier list; the **guidance dial** (Mirror→Teach→Suggest→Prescribe) as a pure presentation layer; **pool provenance** (Option A). Bounded search off the UI thread (web worker). Fixture-driven + browser-verified. |
| M6 — In-game overlay | ⬜ | Tauri v2 overlay. |

## M0 — what landed (all committed)

- **T1** scaffold: Vite 8.0.16 · React 19.2.7 · TS 6.0.3 · Vitest 4.1.9 · Valibot 1.4.1. Commands in [`../CLAUDE.md`](../CLAUDE.md).
- **T2** snapshot schema (`src/schema/snapshot.ts`) — EZWand-grounded stat keys; structured perks `{id,stacks}` + spell bag `{action_id,uses_remaining}`.
- **T3** spell + perk DB schemas (`src/schema/spell-db.ts`, `perk-db.ts`) — numeric `type` enum (0–7), `looseObject` to preserve raw-dump keys.
- **T4** capture mod (`mod/`) + [`capture-manual.md`](./capture-manual.md) — extraction-only; F8 = snapshot, F7 = DB dumps. Vendors EZWand (GPL-3.0). **Confirmed working in-game.**
- **T5** fixtures frozen (`src/data/fixtures/`) + validated against schemas. Real data fixed one schema bug.

**Verified state:** `npm test` 28 pass · `npm run typecheck` clean · `npm run build` clean · `npm run lint` clean. The app runs entirely on fixtures (no game/live-data dependency).

### Schema deviations found vs. the spec's *illustrative* JSON (now matching real game data)
- Spell `type` is **numeric 0–7** (not a string); **no declarative `projectile`/`deck_modifier`** block — effects are imperative in the Lua `action` fn (→ reuse the simulator at M3). Unlimited uses = `max_uses` **absent**.
- `related_projectiles` / `related_extra_entities` are **heterogeneous `string|number` arrays** (`[xml_path, count]`, e.g. `EXPLODING_DUCKS=[".../duck.xml",3]`) — found at T5.
- Perk effects are **not** in the dump (imperative `func`) → optional app-computed `effects{immunities, modifiers}`. Real keys: `ui_name`, `stackable`(bool), `max_in_perk_pool`, `stackable_is_rare`. Fire perk = `PROTECTION_FIRE`.
- Snapshot `uses_remaining` is `nullish` (null or absent = unlimited).

## M2 — what landed (all committed on `feat/m2-mirror`)

- **T1** ingestion boundary (`src/ingestion/ingest.ts`) — `ingestSnapshot`/`ingestSnapshotText` validate untrusted data against the schema and **never throw** (return `{ok,snapshot}|{ok,issues}`). Reuses the verified valibot `safeParse`+`getDotPath` idiom.
- **T2** run-state store + "seen this run" ledger (`src/store/runStore.ts`, **Zustand 5** vanilla store) — pure reducer accumulates the spell/perk/wand pool, resets on `run_id` change. Hardened per a fresh-context review: order-independent wand signature + ledger-persistence tests.
- **Supporting modules** (sharded to parallel agents): `src/data/spellDb.ts` + `perkDb.ts` (lookup/display-name/type), `src/ui/format.ts` (frames→seconds, spread°, mana).
- **T3/T4** the **"grimoire × wand-edit"** UI (user-chosen direction): single-page dashboard (NO pagination) — current wand panel(s) with stat grid + type-coloured spell-rune deck (empty sockets, always-cast), plus the run side (Spell Bag w/ use counts · Perks · "Seen This Run" pool). A marked "Best Builds" slot reserves space for the M4/M5 tier list. `src/ui/{viewModel,SpellTile,WandPanel,RunSidebar,useRunStore}` + `App.tsx` + `index.css`.
- **Sprite-ready:** tiles render a real game `<img>` icon when sprite bytes exist, else the text tile (see M1 icon-export item below).
- **Verified:** 94 unit tests pass · typecheck · lint · production build all clean. **Two fresh-context subagent reviews** (T1+T2 logic; T3+T4 UI + data modules) — both verdict **ship**; all findings addressed (order-independent wand signature; negative-zero formatting; NaN-safe `?capture`; empty-string id guard). Browser-verified (Playwright) across all 3 fixtures — stats incl. negative spread, the GRENADE null slot, the 2×NUKE bag, and pool accumulation 1→3→4; zero console errors. Data source = recorded fixtures via `src/data/demoRun.ts` (`?capture=N` dev override); the live bridge replaces it at M1-T5.

## M3 — what landed (all committed on `feat/m3-engine`)

- **T1** vendored `salinecitrine/noita-wand-simulator`'s `src/app/calc/` into `src/engine/` (byte-faithful + characterization tests; `fast-deep-equal` swapped in for lodash). See `src/engine/README.md`.
- **T2** `src/sim/simulateWand.ts` — maps a snapshot wand → engine `Gun` + `Action[]` (`getActionById`, throw-safe → `missingSpells`/`approximate`) → `clickWand`. always_cast is **prepended** (approximation; flagged). First app-side engine import, so it also established the **engine→app declaration boundary** (`tsconfig.engine.json` is now `composite`/`emitDeclarationOnly`; `tsconfig.app.json` references it) — the app consumes the engine's `.d.ts` instead of re-checking vendored source under the app's stricter `noUnusedLocals`.
- **T3a** `scripts/generate-projectile-stats.mjs` → committed `src/sim/data/projectileStats.generated.ts` (375 entries). The engine carries no projectile damage, so this table is generated from the game's projectile XMLs (`<ProjectileComponent damage>` + `<config_explosion>`, `<Base>` inheritance resolved). **Damage unit 1.0 = 25 HP** (cross-checked 3 ways). Default input = sparse `vexx32/noita-data` clone (`.noita-data/`, gitignored); `NOITA_DATA` path-configurable for the maintainer's own `data/`. `fast-xml-parser` is a devDep. Only the derived numeric table is committed (license caveat in `src/sim/data/README.md`).
- **T3b** `src/sim/metrics.ts` — timing (per-shot delay = `castState.fire_rate_wait`; castDelay already baked in by clickWand, **not** re-added), projectiles/sec, **absolute sustained/burst DPS** (`(base+damage_projectile_add)×25` + explosion), mana sustainability + stall time, effective spread, AoE radius. Characterization goldens for all 3 fixtures.
- **T4** `src/ui/{castViewModel,CastTree,MetricsPanel,CastSimPanel}` into the dashboard's reserved slot (now **"Cast Simulation"**, grimoire theme). The pure `castViewModel` also exercises the lightly-tested `condense`/`combineGroups` grouping.
- **Verified:** 143 unit tests pass · typecheck · lint · build · `npm audit` clean. **Fresh-context review = ship** (one asymmetry fixed: modifier-added explosion damage now counted). Browser-verified (Playwright) across all 3 fixtures — DPS/mana/spread/AoE match the goldens (rubber_ball 7.2 HP/s sustainable · grenade 80 HP "stalls in 6.1s", AoE 7px · bubbleshot 3 casts, AoE 4px); **zero console errors**.

### M3 known approximations / carry-forward (none block M4; flagged in code)
- **DPS is approximate**: raw HP, neutral resistances, single-hit (no pierce/bounce/multi-hit), **crit excluded** (engine state's `damage_critical_multiplier` default is 0.0), triggers not counted in headline DPS, `damage_by_type` captured but not resistance-modeled.
- **Lua-driven meta-projectiles** (`ALL_*` like `all_nukes`) have no `ProjectileComponent` → absent from the table → read as 0 damage with `damageApproximate` set. No fixture exercises them yet.
- **always_cast = prepend** (not true always-cast semantics) and **shuffle wands report one deterministic seed-0 sample**. Both flagged; revisit when M1 captures such wands.

## M4 — what landed (all committed on `feat/m4-analysis`)

New analysis engine under `src/analysis/` (pure, React-free, node-tested) feeding a tier-list UI. Built on M3's evaluator, now memoized.

- **A — sim cache** `src/analysis/{wandKey,simCache}` — extracted runStore's pool-dedup signature → `wandKey` (ONE keying scheme; excludes volatile mana), and `evalWand` memoizes `simulateWand`→`computeMetrics`. `castViewModel` now consumes it (killed the per-render double-simulation). Performance is a hard requirement (spec §6.4).
- **B — feature maps** `src/analysis/features/{spellFeatures,perkEffects}` — curated spell-id→feature tags (DIG/MOBILITY/DEFENSIVE/HOMING/MULTICAST/TRIGGER/NUKE) since `type=UTILITY` is a grab-bag (only MULTICAST is type-derivable, +a drill-damage entity fallback); curated perk-id→`PerkEffects` populating the schema's **existing** immunity shape + the PROJECTILE_REPULSION/EATER self-neutralizers.
- **C — self-danger** `src/analysis/selfDanger.ts` — perk-relative veto. Point-blank FIRE + explosion-IN-FACE are lethal (→ Unsafe band); TOXIC + RECOIL are warn-only. "In your face" is geometric (blast radius vs projectile reach = `speedMax×lifetime/60`), anchored by the game's `is_dangerous_blast` flag, **gated on `explosionDamage>0`** so harmless digging explosions (digger) are excluded. Immunities + projectile-repulsion neutralize.
- **D — scoring** `src/analysis/{archetypes,index}` — signature-dominant per-archetype scoring on **absolute** bands (S/A/B/C/D at 80/60/40/20) via a saturating normalization; mana-sustainability is a near-gate (×0.6 DAMAGE, ×0.35 SPAM). `analyzeWand(wand, perks)` joins cached metrics + scores + the self-danger report.
- **E — suggestions** `src/analysis/suggestions.ts` — depth-1 local search (single swap from the owned+seen pool / adjacent reorder / removal) ranked by target-archetype gain; self-danger is a veto (discards danger-introducing edits, rewards hazard-removing ones with a visibility bonus); equivalent edits deduped by label. Main thread + memoized; beam/worker deferred to M5.
- **F — UI** `src/ui/{tierListViewModel,TierListPanel,ArchetypeBoard}` — archetype tabs over one rich ranked **S/A/B/C/D + Unsafe** column each, replacing the "Best Builds" placeholder; reuses `SpellTile` + grimoire tokens.
- **Verified:** 206 unit tests pass · typecheck · lint · build · `npm audit` 0 vulns. **Fresh-context review = ship** (all six settled decisions confirmed; no blocking issues). Browser-verified (Playwright) — Damage↔AoE tab switch re-renders per-archetype metrics + deduped suggestions (Bubbleshot→Nuke +73 AoE), `?capture=1` null-slot degrades gracefully; **zero console errors**.

### M4 settled decisions (this milestone)
- **Self-danger = separate Unsafe band** (user-chosen; not cap-at-tier, not a soft penalty): a self-lethal held wand is banished below the S–D ladder in **every** column, still showing its would-be tier + the fixing perk.
- **Scoring = signature-dominant + mana near-gate**; **absolute** tier bands, not relative-within-pool (M5 must rank generated builds on the same yardstick).
- **UI = archetype tabs** (one rich column, single page).

### M4 known approximations / carry-forward (none block M5; flagged in code)
- **Self-danger + perk-immunity is tested with SYNTHETIC perks only** — `perks: []` in every fixture (M1-deferred), so it is **not validated end-to-end** against a real perk-bearing capture.
- **Scoring reference constants are provisional/uncalibrated** (`archetypes.ts` REF/MANA_PENALTY) — the only goldens are the 3 tiny fixtures, and DPS itself is approximate (M3). First thing to tune against real wands.
- **FIRE danger leans on a curated `CLOSE_FIRE` set** (flamethrower) for point-blank fire that geometry alone wouldn't flag; modded flame streams won't be caught until added. **RECOIL** uses a single provisional `warn` threshold (50, not the plan's illustrative 12); the engine does populate `castState.recoil`, but the threshold is uncalibrated. **NUKE-class** projectiles aren't flagged self-dangerous (they fly far before detonating, per the reach heuristic) — defensible but uncalibrated.
- **`secondsUntilStall` is cached at first-seen mana** (wandKey excludes volatile mana); scoring keys off the mana-independent `manaSustainable`, so tiers are unaffected.
- **Suggestions feed targets the primary held wand** (slot 0); multi-wand suggestion merging is future.

## M5 — what landed (all committed on `feat/m5-generation`)
- **Prelude** — extracted `applyEdit(wand, edit)` from `suggestions.ts` so the suggestion neighborhood and generation polish share ONE deck transform; `src/generation/budget.ts` holds the search bounds (`BUILDS_PER_ARCHETYPE`, `MAX_ROUNDS`, `MAX_CANDIDATES`, `IMPROVE_EPS`, `POLISH_POOL_MAX`) — provisional like the M4 REF constants.
- **T1 — provenance (Option A)** `src/store/runStore.ts` — `RunLedger.provenance: Map<spellId, {origin, origins[], fresh, firstSeen, lastSeen}>` accumulated across the run ALONGSIDE the untouched `spells`/`perks`/`wands` (App's pool keeps working). One `taggedSpellsOfSnapshot` feeds both the pool Set and provenance (can't drift); precedence owned > pedestal > shop > holy_mountain; `fresh` recomputed per snapshot (on-screen-now). `src/generation/provenance.ts` joins it to the "go grab X" label on the main thread.
- **T2 — generation core** `src/generation/{poolIndex,templates,generate,constraints(inlined),copy}.ts` — template SEED (single-nuke / trigger→payload [shuffle-gated] / multicast-stack / spammer / feature-fill) → bounded local-search POLISH (iterated `suggestEdits`) → dedup by `wandKey` → constraint filter (must-dig / no-self-damage) → rank (safe above unsafe) → top-3. Reuses the M4 engine wholesale (analyzeWand fitness, evalWand cache, selfDanger/`fixableByPerk` for perk advice). Per-archetype candidate budget via the sim-cache-size delta; full-DB theorycraft pool trimmed to top-60 by feature. Deterministic + node-tested incl. a measured full-DB guard.
- **T3 — worker + uiStore** `src/generation/{worker,workerClient}.ts` + `src/store/uiStore.ts` + `src/ui/{useUiStore,useGeneration}.ts` — generation runs OFF the UI thread (Vite emits a separate ~488 kB worker chunk); thin worker, lazy-singleton client with reqId staleness drop; debounced (250ms) driver feeds `uiStore.gen`. uiStore holds the dial (rung default `suggest`, per-card `drilled` set, theorycraft, constraints) + the gen lifecycle.
- **T4 — the guidance dial UI** `src/ui/{tierListViewModel,ArchetypeBoard,TierListPanel,DialControl}.tsx` + `index.css` — generated builds merge into the SAME archetype bands as held wands; a per-entry `reveal` (computed in the pure view-model from `REVEAL[rung]`) decides how much each rung shows, and any card's `▸ drill` forces it to Prescribe inline. Browser-verified (zero console errors): worker round-trip, rung switching, Prescribe provenance chips ("your bag"/"shop"), Mirror hides builds, Teach shows the mechanic why, per-card drill, constraint/theorycraft re-trigger with a loading state.

### M5 known approximations / carry-forward (none block M6; flagged in code)
- **Provenance + perk-pick advice are SYNTHETIC-only** — `world_seen` and `perks` are empty in every REAL fixture (M1-deferred), so the "go grab X" path + perk advice are built and unit-tested against the hand-authored `snapshot_04.json` + synthetic perks ONLY — **not validated end-to-end**. (Same posture as M4's empty perks.)
- **Generation polish can't fill an empty deck slot** — `suggestEdits` only swaps/removes/reorders non-null slots, so templates must (and do) seed populated decks; build quality is bounded by the template shape + depth-1 polish, not exhaustive search.
- **Search bounds + the polish-pool trim are uncalibrated** (`budget.ts`) — they keep generation interactive (measured), but the specific caps/`POLISH_POOL_MAX=60` aren't tuned against real large pools.
- **Inherits all M4 approximations** (DPS approximate, scoring constants provisional) — generated builds are ranked on the same uncalibrated yardstick.

## Post-M5 — app polish (2026-06-22, `feat/m5-generation`)

Quality/UX work layered on the finished engine — all [APP], fixture-driven, browser-verified:

- **Real game sprites, extracted OFFLINE** (no game/mod). `scripts/extract-sprites.mjs` parses the install's `data/data.wak` index and embeds a base64 `sprite_base64` per entry into the bundled spell/perk DBs (422/422 spells + 105/105 perks). The app was already sprite-ready, so icons render on every tile + perk chip. Vanilla "bundled fallback" (invariant #5); the mod stays for modded/version-accurate live sprites (same field). (Open item #5.)
- **In-game-style hover tooltips** (spells + perks) via **`@floating-ui/react`** (Context7-grounded: `useFloating` + `useHover`/`useFocus`/`useDismiss`/`useRole` + `flip`/`shift`/`offset` + `FloatingPortal`). Shows real **name (type-coloured) + type + mana/uses + description**. Real names/descriptions resolved from the engine's vendored vanilla translation table by a UI-only `src/ui/loc.ts` (kept OUT of the engine/worker bundle). New `src/ui/{useTooltip,GameTooltip,PerkChip}` + `loc` (unit-tested).
- **Compact 3-column layout** — app widened (1240→2200px); the stacked sections split into *current · builds · run* columns, so the whole page fits a maximized 1440p (2560×1440) window with **zero scroll** (verified). Stacks to one column under 1400px.
- **Dial self-explains** — the active rung's meaning shows inline (e.g. "Mirror — just your wands + what they do, no advice"), answering "what is the Mirror rung?".

New dep: `@floating-ui/react` 0.27 (0 vulns, React 19 OK). Bundle: ~340 kB sprites (main + worker) + ~150 kB translations (main only) → main ≈ 343 kB gzip; fine for a local app, splittable later. 271 tests pass; one narrow, documented `react-hooks/refs` eslint-disable in the two tooltip files (Floating UI callback-ref false positive).

## Current fixtures
- `snapshot_01.json` — starting wand `RUBBER_BALL ×2`, cap 2; **empty bag, no perks** (fresh game). `snapshot_02/03.json` — captured 2026-06-21 (modded co-op).
- `snapshot_04.json` — **HAND-AUTHORED synthetic** (M5): continues run-10 with a populated `world_seen` (shop/pedestal/perk offerings) so the provenance + Prescribe "go grab X" path renders in the browser. Not a real capture (mod world-scan is M1-T6).
- `spell_db.json` — 422 spells. `perk_db.json` — 105 perks. (Captured in the maintainer's **modded** setup, not pristine vanilla — see open items.)

## Open items / flags (updated after 2nd capture, 2026-06-21)

**Resolved by the 2nd capture:**
- ✅ **Vanilla spell-bag read works** — captured 2× `NUKE` with `uses_remaining: 1` (so `inventory_full` enumeration + `ItemActionComponent.action_id` + `ItemComponent.uses_remaining` all work).
- ✅ **Held-wand + 0-based deck confirmed** across 3 wands (RUBBER_BALL, GRENADE with a null gap, BUBBLESHOT×3).

**Confirmed broken / open (feed M1):**
1. **Perk capture returns empty** — `perks: []` despite a perk being held; `GameHasFlagRun("PERK_PICKED_<id>")` matched nothing. Likely **quant.ew (Entangled Worlds) perk handling** or a flag-name difference → M1-T3 must investigate (`_PICKUP_COUNT` stacks still unconfirmed too).
2. **Advanced Spell Inventory spells not captured** — the mod reads only the vanilla bag; spells moved into the Advanced Spell Inventory mod are invisible. This is the planned **M1-T4** compat work (Globals `AdvancedSpellInventory_stored_spells`).
3. **`run_id` collides** — both runs got `run-10` (placeholder = frame # at spawn). The app keys run-reset on `run_id`, so **M1 must use a real seed/session id**.
4. **Inventory-slot wands** — M0 captures only the HELD wand; the player's other carried wands need **M1-T2** enumeration (press F8 per wand for now).
5. **Real spell/perk ICONS — ✅ DONE OFFLINE (2026-06-22), no game/mod needed.** The bundled spell/perk DBs now carry a base64 `sprite_base64` per entry, extracted directly from the install's `data/data.wak` by **`scripts/extract-sprites.mjs`** (parses the wak index, no `noita.exe -wizard_unpak` needed) — 422/422 spells + 105/105 perks. The app was already sprite-ready (`viewModel.resolveSpriteSrc` / `SpellTile`; perks via `perkDb.perkSpriteSrc` + `RunSidebar`), so icons render everywhere now (browser-verified). This is the "vanilla bundled as fallback" of invariant #5; the **mod path stays** for modded spells + version-accurate LIVE sprites (it emits the same `sprite_base64` field, so no app change). **Wand icons** remain a follow-on (procedurally composed from parts, not a single PNG). Tradeoff: ~340 kB added to the main + worker bundles — fine for a local app; split into a UI-only sprite fixture if it ever matters.

**Still true:**
- **Diagnostics don't log** — release build doesn't route `print()` to `logger.txt`; use `GamePrint` or write a diagnostics file.
- **Fixture coverage** — now 3 wands + a non-empty bag, but still no shuffle/multicast/trigger/mana-hog wand and no perks; more variety welcome.
- **Modded co-op env** — fixtures reflect quant.ew + Advanced Spell Inventory (representative of real use).

## Product decisions (2026-06-21 — full text in spec Decisions Log v0.2.1)
- **Output = tier list (S/A/B/C) per archetype** (Damage / Spam / AoE / Utility-mobility / Defensive), ranking **both held wands and generated builds** — never a single "best wand."
- **Pool = owned + seen-in-world** (read-only; current shop/pedestal/Holy-Mountain only; never the unexplored map). Stricter owned-only available as a setting.
- **Performance is a hard requirement** — fast/responsive sim so the tier list re-ranks at interactive speed (bounded search, heavy work off the UI thread, cached sims). Shapes the M3 engine choice + M4/M5 search.

## What's next — M1 (make it LIVE), then M6

Everything doable against fixtures is done: the app is feature-complete (mirror → simulate →
analyze → generate → dial) and polished (real sprites, hover tooltips, 1440p layout). The remaining
value is **live data** — connecting to the running game.

- **M1 — extraction mod + live bridge** is the next milestone, and the ONLY work needing the running
  game. It unblocks the standing caveats: **real perks** (retro-validates self-danger + perk-pick
  advice end-to-end), the **world-scan slice M1-T6** (real shop/pedestal/Holy-Mountain → live
  provenance + "go grab X"), real `run_id`, all-wand enumeration, and Advanced Spell Inventory
  compat. (Sprites are already handled offline.)
  - **M1-T5 (live bridge sidecar) is [APP]-testable** — a small chokidar→WebSocket sidecar behind
    `VITE_LIVE=1`; buildable + unit-tested solo and provable with a fake snapshot file before the mod
    is ready. Good first slice, no game needed.
  - **M1-T1..T4 + T6 are [MOD]** = human-in-the-loop: implement thin Lua → STOP → hand a copy-paste
    in-game test script → user verifies/pastes. Carries the 12-point in-game checklist. Keep the mod
    thin (every line added can't be auto-tested).
- **M6 — Tauri v2 overlay** — defer until live data flows (the overlay shows the live assistant
  in-game; pointless before M1).
- **Calibration** (M4 REF constants, generation bounds) needs real wands → after M1 captures land.

Start M1 in a **fresh session** (this one is context-heavy); the mod is the untestable piece.

Two product asks captured during M2 (do NOT lose):
- **Real icons** "from the actual run" — M1 mod must export `sprite_base64` (item 5 above); app is already sprite-ready.
- **No pagination / best wands on one page** — honored in the M2 layout; M4/M5 tier list drops into the "Best Builds" slot, not a separate page.

**Deferred to M1** (human-loop, logged above): quant.ew perk read, Advanced Spell Inventory spells, all-4-wands enumeration, real `run_id`, and the **world-scan slice (M1-T6)** — "nearby" / shop / pedestal / Holy-Mountain wands, spells, and perk offerings. The optional `world_seen` field already exists in the snapshot schema, so the app can ingest it now; **capturing** it is M1-T6 (test standing in a shop / Holy Mountain, [MOD]), and **using** it as the "seen-in-world" pool is M5. Exact shape (shop spells vs shop/pedestal wands vs floor drops) gets pinned against real captures then. Do when richer live data is needed.
