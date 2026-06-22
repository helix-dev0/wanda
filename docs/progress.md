# Progress & status

> Living status doc. Companion to [`plan.md`](./plan.md) (the milestone breakdown) and
> [`../noita-wand-assistant-spec.md`](../noita-wand-assistant-spec.md) (the design).
> **Last updated: 2026-06-22** · branch `feat/m4-analysis` (off `feat/m3-engine`; M0 merged to `master`).

## Milestone status

| Milestone | Status | Notes |
|---|---|---|
| **M0 — Fixtures & schema** | ✅ **COMPLETE** (T1–T5) | App is now buildable against fixtures with zero further game access through M5. |
| M1 — Extraction mod + bridge | ⬜ not started | Evolve the M0 capture seed into the real emit-on-change mod + live bridge. |
| **M2 — Ingestion + store + mirror UI** | ✅ **COMPLETE** (T1–T4) | First **visible** milestone — single-page wand-mirror dashboard, fixture-driven + browser-verified. |
| **M3 — Simulator integration** | ✅ **COMPLETE** (T1–T4) | Vendored `salinecitrine` `calc/`; sim layer + projectile-damage table + metrics + cast-tree UI. Fixture-driven + browser-verified. |
| **M4 — Analysis engine** | ✅ **COMPLETE** (T1–T4) | Archetype scoring + self-danger (perk-aware veto, separate **Unsafe** band) + depth-1 local search → **tier list per archetype** for held wands. Fixture-driven + browser-verified. |
| M5 — Generation engine | ⬜ | Template-seeded generation → **tier list of buildable options** per type, from owned+seen pool. |
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

## Current fixtures (captured 2026-06-21)
- `snapshot_01.json` — starting wand `RUBBER_BALL ×2`, cap 2; **empty bag, no perks** (fresh game).
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
5. **Real spell/wand ICONS (new — user-requested 2026-06-21)** — the app is already sprite-ready, but needs the mod to export sprite **bytes**. The DB dump has only sprite PATHS (`data/ui_gfx/gun_actions/*.png`) whose bytes live packed in `data.wak`. **M1 mod task:** when dumping the spell DB, base64-encode each spell's sprite PNG into a **`sprite_base64`** field (spell-DB `looseObject` round-trips it; `viewModel.resolveSpriteSrc` already builds the `data:` URL). Then re-capture. Confirm the PNG-read approach against real `io`/game access ([[noita-component-explorer]] can help). Wand icons are a follow-on (sprites are procedurally composed).

**Still true:**
- **Diagnostics don't log** — release build doesn't route `print()` to `logger.txt`; use `GamePrint` or write a diagnostics file.
- **Fixture coverage** — now 3 wands + a non-empty bag, but still no shuffle/multicast/trigger/mana-hog wand and no perks; more variety welcome.
- **Modded co-op env** — fixtures reflect quant.ew + Advanced Spell Inventory (representative of real use).

## Product decisions (2026-06-21 — full text in spec Decisions Log v0.2.1)
- **Output = tier list (S/A/B/C) per archetype** (Damage / Spam / AoE / Utility-mobility / Defensive), ranking **both held wands and generated builds** — never a single "best wand."
- **Pool = owned + seen-in-world** (read-only; current shop/pedestal/Holy-Mountain only; never the unexplored map). Stricter owned-only available as a setting.
- **Performance is a hard requirement** — fast/responsive sim so the tier list re-ranks at interactive speed (bounded search, heavy work off the UI thread, cached sims). Shapes the M3 engine choice + M4/M5 search.

## What's next — M5 (M4 ✅ complete)

**Active next step: M5 — generation engine** ([APP], fixture-driven). Template-seeded build generation → a **tier list of buildable options** per archetype from the owned+seen pool, with perk-pick advice. Build on what M4 landed:
- `src/analysis/{index,archetypes,selfDanger,suggestions}` is the scorer / veto / local-search the generator reuses: `analyzeWand` ranks any candidate, `suggestEdits` is the depth-1 polish, the **Unsafe band + perk-aware veto** already exist. **Reuse `evalWand`'s cache** for interactive generation (performance is a hard requirement — spec §6.4).
- Pool = `runStore.ledger.spells` (owned+seen); add the theorycraft full-DB toggle (M5-T1), template detection — nuke / trigger / multicast / spammer (M5-T2), template-seeded generation under a real chassis + constraints + **perk-pick advice** "take Projectile Repulsion to make this build safe" (M5-T3), and the "Build me a wand" UI (M5-T4). The tier list drops into the same "Best Builds" columns.
- **Bound the combinatorial search** (spec §6.4) and **push heavy work off the UI thread** (web worker) — deferred from M4 where depth-1 single-edit was enough.
- Mind the M4 carry-forward above: scoring constants are uncalibrated and self-danger is synthetic-perk-only until M1 captures real perks.
- **Expanded scope (2026-06-22, spec §6.5):** M5 now also owns the **guidance "assistant dial"** — output is tunable across **Mirror → Teach → Suggest → Prescribe** (teaching richest at the low end, fading to terse exact builds; global default + per-card drill-down) — and the pool gains **per-item provenance** (owned / shop / pedestal / Holy-Mountain) to power the Prescribe rung's "go grab X." The dial is a *presentation layer over the same M3/M4/M5 engine*. Mirror+Suggest already shipped (M2/M3/M4); **Teach + Prescribe + the dial + provenance are the new M5 work** (M5-T1 = pool-assembly-with-provenance, recommended Option A: ledger tracks origin). Re-decompose M5 against the updated spec.

Build in a **fresh session** (this one is context-heavy).

Two product asks captured during M2 (do NOT lose):
- **Real icons** "from the actual run" — M1 mod must export `sprite_base64` (item 5 above); app is already sprite-ready.
- **No pagination / best wands on one page** — honored in the M2 layout; M4/M5 tier list drops into the "Best Builds" slot, not a separate page.

**Deferred to M1** (human-loop, logged above): quant.ew perk read, Advanced Spell Inventory spells, all-4-wands enumeration, real `run_id`, and the **world-scan slice (M1-T6)** — "nearby" / shop / pedestal / Holy-Mountain wands, spells, and perk offerings. The optional `world_seen` field already exists in the snapshot schema, so the app can ingest it now; **capturing** it is M1-T6 (test standing in a shop / Holy Mountain, [MOD]), and **using** it as the "seen-in-world" pool is M5. Exact shape (shop spells vs shop/pedestal wands vs floor drops) gets pinned against real captures then. Do when richer live data is needed.
