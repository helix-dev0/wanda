# Progress & status

> Living status doc. Companion to [`plan.md`](./plan.md) (the milestone breakdown) and
> [`../noita-wand-assistant-spec.md`](../noita-wand-assistant-spec.md) (the design).
> **Last updated: 2026-06-26** · branch `scoring-model-v2`. 451 tests green.
>
> 🟢 **SCORING v2 SHIPPED + live-hardened.** The TTK-grounded rebuild
> ([`docs/scoring-model-v2-spec.md`](./scoring-model-v2-spec.md)) replaced the patched heuristic scorer
> in place (S0→S6): DAMAGE/AOE/SPAM are **expected time-to-kill vs cited reference enemies**
> (Haulikkohiisi 22.5 / Isohiisi 150 / Ylialkemisti 1000), DIGGING is a first-class **capability ×
> sustainability** archetype, MOBILITY is a capability flag, DEFENSIVE dropped. Validated by the
> first-class **3-layer corpus harness** (`src/data/corpus/`, Layers A/B/C + the §7.5 ground-truth
> cases), a **meta-expert sign-off** (PASS-WITH-NOTES → its two material ordering gaps fixed: SPAM
> overkill-cap, dig-sustainability softening), and a **fresh-context diff review** (3 gaps fixed: DoT
> bisection-stability, the trigger-connect reliability note, missing regressions) — all green;
> tier-list UI browser-verified. Pierce came from a projectile-table regen (`penetrate_entities`/
> `on_collision_die`).
>
> 🛠 **Live-hardened on the maintainer's real run (2026-06-26):** fixed DAMAGE=0 for utility-first
> wands (TTK counts the WHOLE cycle, not just the first cast — a Luminous-Drill-first wand read
> "can't kill"); **perks now apply to scoring** (Critical Hit + = +10%/stack, in `scoreWand`);
> **charge-limited builds filtered** out of generation unless the Unlimited Spells perk (+ a "show
> charge builds" toggle); **TTK hidden from the UI** (cards show DPS; TTK stays the scoring unit);
> **suggestions no longer reshuffle** when you rearrange spells you already own (`chassisKey` keys
> regen on chassis+owned-pool, not the deck); always-cast confirmed applied (RECHARGE ~5×'s DPS).
>
> **Known scorer blind spots (provisional / flagged — not bugs):** band cutoffs are PROVISIONAL
> (#9-grounded method; the meta-expert tunes the numbers); **homing/accuracy is unmodeled** (both the
> meta-expert and the maintainer's homing wand flagged it — the top remaining gap, and it would also
> correctly penalize wide-spread spray builds); **always-cast is an APPROXIMATION** (prepended to the
> deck, not fired per-cast); the mana penalty assumes CONTINUOUS fire (over-penalizes tap-fire). Open
> items live in `docs/scoring-v2-test-notes.md`.

## Milestone status

| Milestone | Status | Notes |
|---|---|---|
| **M0 — Fixtures & schema** | ✅ **COMPLETE** (T1–T5) | App is now buildable against fixtures with zero further game access through M5. |
| **M1 — Extraction mod + bridge** | 🔶 **in progress** | **Live-validated in-game:** AUTO emit-on-change snapshot — all carried wands + active flag + spell bag + perks (T1/T2), chokidar→WS bridge (T5), and (2026-06-26) **F8 = full spell/perk DB dump** (snapshot is auto-only now, no keypress) + **✅ Advanced Spell Inventory compat (T4)** — reads ASI's `AdvancedSpellInventory_stored_spells` Globals-string storage (confirmed in-game: bag 12→27). Pending: real `run_id`=world-seed (T3), world-scan (T6). |
| **M2 — Ingestion + store + mirror UI** | ✅ **COMPLETE** (T1–T4) | First **visible** milestone — single-page wand-mirror dashboard, fixture-driven + browser-verified. |
| **M3 — Simulator integration** | ✅ **COMPLETE** (T1–T4) | Vendored `salinecitrine` `calc/`; sim layer + projectile-damage table + metrics + cast-tree UI. Fixture-driven + browser-verified. |
| **M4 — Analysis engine** | ✅ **COMPLETE** (T1–T4) | Archetype scoring + self-danger (perk-aware veto, separate **Unsafe** band) + depth-1 local search → **tier list per archetype** for held wands. Fixture-driven + browser-verified. |
| **M5 — Generation + dial + provenance** | ✅ **COMPLETE** (prelude, T1–T4) | Template-seeded + locally-polished builds merged into the per-archetype tier list; the **guidance dial** (Mirror→Teach→Suggest→Prescribe) as a pure presentation layer; **pool provenance** (Option A). Bounded search off the UI thread (web worker). Fixture-driven + browser-verified. |
| M6 — In-game overlay | ⬜ | Tauri v2 overlay. |

## M0 — what landed (all committed)

- **T1** scaffold: Vite 8.0.16 · React 19.2.7 · TS 6.0.3 · Vitest 4.1.9 · Valibot 1.4.1. Commands in [`../CLAUDE.md`](../CLAUDE.md).
- **T2** snapshot schema (`src/schema/snapshot.ts`) — EZWand-grounded stat keys; structured perks `{id,stacks}` + spell bag `{action_id,uses_remaining}`.
- **T3** spell + perk DB schemas (`src/schema/spell-db.ts`, `perk-db.ts`) — numeric `type` enum (0–7), `looseObject` to preserve raw-dump keys.
- **T4** capture mod (`mod/`) + [`capture-manual.md`](./capture-manual.md) — extraction-only. Vendors EZWand (GPL-3.0). **Confirmed working in-game.** (Hotkeys later changed at M1: snapshot is now AUTO-only; **F8 = DB dump**.)
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

## First live run — mod pipe VALIDATED + a generation bug (2026-06-22)

First real end-to-end run (mod → bridge → app, no fixtures). **Validated in-game:**
- **M1-T1 auto emit-on-change · M1-T5 bridge · M1-T2 all carried wands.** The mod wrote
  `snapshot.json` ~2×/sec; the app showed all **4** carried wands with the held one flagged
  `active` (slot 3), updating live as the player changed wands. The wand-switch "glitch" (panel
  flashing empty) is gone now that all wands are always present.
- **Perks read** (`REVENGE_BULLET` captured) — the M0 "perks empty" issue did NOT recur in this
  (solo) run. `run_id` is the spawn frame number (`run-65220`) — unique within a session, still not
  the world seed (collides across launches → M1-T3).

**🔴 CONFIRMED generation bug — TOP PRIORITY: no per-spell QUANTITY.**
- The run-state pool is a `Set<string>` (`src/store/runStore.ts` → `RunLedger.spells`), so it loses
  HOW MANY of each spell you own. Generation then treats every pooled spell as **unlimited**: the
  `multicast-stack` / `spammer` templates (`src/generation/templates.ts`) fill the deck with the
  cheapest projectile repeated, and `suggestEdits` swaps freely. **Seen in-game:** a "Multicast
  build" with ~15 `DIGGER` when the player owns **one** (it's mana-0 → "cheapest" → spammed). Builds
  aren't actually buildable.
- The snapshot DOES preserve counts (duplicate bag entries + per-deck copies) — live data had
  `CHAINSAW ×~9`, `BURST_2 ×2`, 1 each of SPITTER/MINE/BOMB/DIGGER. The `Set` pool discards them.
- **Fix:** track per-spell OWNED count (copies across all wand decks + bag, from the *current*
  snapshot) and make generation + suggestions respect available copies (owned, later + seen-in-world
  with provenance). Quantity is a CURRENT-state thing (decks+bag now), distinct from the cumulative
  "Seen This Run" ledger. See "What's next".

**Also found:** `uses_remaining: -1` (Noita's "unlimited" sentinel) isn't normalized → unlimited
spells render "×-1". Normalize `< 0` → null at ingestion (and/or emit `null` from the mod).

### ✅ FIXED (2026-06-22, `feat/m5-generation`) — per-spell quantity + the `-1` render
- **Owned-count cap (owned-only v1).** `ownedCounts(wands, spellInventory)` (`src/store/runStore.ts`)
  = occurrences across all carried wand decks + bag entries (excludes always-cast & world_seen;
  ignores `uses_remaining`). Threaded `GenerateRequest.counts` → `worker.ts` → `generate()` → a
  **shared per-seed `used` multiset** in every template (`place`/`draftFill`, so overlapping index
  buckets like DIGGER = digger **and** projectile can't double-place) + `suggestEdits` (a swap is
  dropped once the deck already holds all owned copies). `useGeneration` builds the pool **and** caps
  from the CURRENT snapshot (not the cumulative ledger); theorycraft stays uncapped. Tier-list live
  suggestions cap too (`App` → `tierListView` `opts.caps`).
- **`uses_remaining < 0 → null`** normalized at the schema boundary (valibot transform) → the bag no
  longer renders "×-1".
- **Verified:** 306 tests green — incl. a `snapshot_05` CHAINSAW×8 / DIGGER×1 fixture asserting no
  generated deck exceeds owned counts, plus a CONTROL proving it floods *without* caps so the thread
  can't silently regress; typecheck / lint / build / `audit` clean; **browser-confirmed live** (every
  build DIGGER ≤ 1, CHAINSAW ≤ 8 with correct spill, bag shows no "×-1"). Fresh-context review:
  APPROVE, nothing blocking.
- **Scope:** owned-only. Shop/pedestal "go grab" availability + provenance counts = **Phase 2**
  (needs the M1-T6 world-scan to emit `world_seen`).

## ✅ Engine grounding — scoring re-grounded in the meta (2026-06-22)

Driving the live app on a real run exposed the deepest issue: **the plumbing + simulation were sound,
but the SCORING/analysis model was blind to the real Noita meta**, so "best build" / the tier list /
suggestions couldn't be trusted. Web-research grounding (noita.wiki.gg + the salinecitrine reference) +
the staged fix live in **[`docs/scoring-grounding-spec.md`](./scoring-grounding-spec.md)**. The three
holes — now **FIXED** (see "Fixed" below):

1. **SPAM has no damage term** — `scoreSpam = sat(projectilesPerSecond, 8)` (`archetypes.ts`), nothing
   else. A 0-damage **CHAINSAW** (mana 1, the game's cast-delay *enabler*, not a damage spell) maxes it
   and out-ranks the player's real wand that did **~3× the DPS** (294 vs 107 by our own metric; SPAM 93
   vs 99). Confirmed: *"high projectiles/sec alone is insufficient"* (Rapid-Fire guide).
2. **Trigger PAYLOAD damage is invisible** — `shotDamage` (`sim/metrics.ts`) sums only TOP-LEVEL
   `shot.projectiles`. The entire high-damage meta delivers damage through payloads (a trigger casts the
   payload on impact); our forked engine already holds it at `Projectile.trigger?: WandShot` (recursive,
   built in `clickWand.ts`) — we just never walk it. So the strongest builds score **~0 damage**. Biggest
   blind spot.
3. **Multiplicative stacking ignored** — damage is additive (`damage_projectile_add`) only; crit (×5+),
   velocity (×200), and the multicast-modifier-broadcast are unmodeled. (Flat adds like Damage Plus +10
   ARE additive — so additive isn't *wrong*, it's *incomplete*.)

Plus: generation hill-climbs this broken fitness, so it actively *seeks* the chainsaw deck (fix scoring →
fix generation for free), builds only on the HELD chassis (never the player's bigger wands or an ideal
one — spec §6.3 wants chassis selection), and depth-1 search can't *discover* multi-slot trigger chains.

**✅ Fixed (2026-06-22, all 3 holes):** payload-aware damage (`shotDamage` recurses
`Projectile.trigger`) + `maxExplosionDamage`; SPAM = `sat(sustainedDps)×rate×mana-gate` (chainsaw
inversion gone — held **S-84** vs chainsaw **B-51** live); AoE weights explosion DAMAGE not just radius;
and multiplicative **crit** (`CRITICAL_HIT` → ×1.5, stacks; from the engine-populated
`damage_critical_chance` + the wiki ×5 formula). **316 tests green, fresh-context review APPROVE,
browser-validated, goldens byte-identical.** **Remaining (Tier 1+, specced, NOT guessed):** velocity +
range/lifetime usability, status/DoT, effective-DPS mana model, generation **chassis-selection** (build
on your *best* wand — the "best wand from my spells" gap) + multiplicative-stack templates + deeper
search, and REF-constant **calibration against real captures** (`npm run record`).

## ✅ Generation chassis-selection — build on ALL owned wands (2026-06-22)

The maintainer's "it won't build the best wand from my spells" gap: generation built decks ONLY on the
HELD wand's chassis, ignoring the player's other (often roomier) wands. **Fixed** ([APP], spec
[`scoring-grounding-spec.md`](./scoring-grounding-spec.md) Tier 2): generation now builds on **every
owned wand** (≤4). `GenerateRequest.chassis` became a `Wand[]`; `generateForArchetype` loops the chassis
into one candidate pool and the now-trustworthy scorer + the existing per-archetype tier-list merge
surface the best (wand, deck) per archetype. Each build is attributed to its source wand —
**"rebuild your slot-2 wand · cap 19"** — built **icon-ready** (a null `resolveWandSpriteSrc` seam
mirroring the spell-sprite one; lights up when the mod emits per-wand sprites). A **fair per-chassis
sub-budget** (`ceil(MAX_CANDIDATES/N)`) stops chassis #1 starving the rest; **N=1 (theorycraft) is
byte-identical** to the old single-chassis path; owned caps stay per-build (each build is an independent
"rearrange one wand" proposal). Files: `src/generation/{types,generate,worker}.ts`,
`src/ui/{useGeneration,tierListViewModel,viewModel,ArchetypeBoard}`, `src/index.css`. **Verified:** 330
tests (13 new: roomier-chassis-wins via a multicast pool, caps-across-chassis, global-top-N, N=1
byte-identity guard, determinism, no-starvation); typecheck/build clean; **fresh-context review
APPROVE**; app loads live with **zero console errors**. **Remaining (Tier 2):** multiplicative-stack
templates + deeper-than-depth-1 search; **wand ICONS** for the per-wand label are a follow-on (wand
sprites are procedurally composed, not single PNGs → needs the mod to emit `sprite_base64` per wand,
human-in-the-loop — the app is already icon-ready).

### 🔴 MOD bug found during live validation — stale `player_entity` (M1, human-in-the-loop)
Driving the live app on a real 4-wand run (CHAIN_BOLT cap8 / X_RAY cap2 / BOMB cap1 / MINE cap3), the
capture mod **stopped emitting wands** mid-run — `snapshot.json` froze with `wands: []` after reading
the 4 fine, while the game kept running. Root cause: `mod/init.lua:184` caches the player
(`if not player_entity then player_entity = EntityGetWithTag("player_unit")[1] end`) and **never
refreshes it**, so after a **death/respawn** (the maintainer's quant.ew co-op has respawn) the cached
entity is dead → `read_all_wands` finds no `inventory_quick` → emits `[]` forever (F8 won't help; same
cached entity). **Fix (1-liner, [MOD] human-in-the-loop):** refresh when the cached entity is dead, e.g.
`if not player_entity or not EntityGetIsAlive(player_entity) then player_entity = EntityGetWithTag("player_unit")[1] end`
— implement → STOP → maintainer reloads + confirms in-game. This is **separate from the [APP]
chassis-selection change** (which is fully fixture/unit-verified); it only blocked the live multi-wand
*browser* confirmation.

## ✅ Engine fidelity — fast-wand DPS, lobbed-explosive danger, mana/shuffle (2026-06-23)

Driving the live app on a real *"super fast, lots of damage, no mana drain"* wand
(`MANA_REDUCE×2, CRITICAL_HIT, BURST_2, LASER, LUMINOUS_DRILL`) exposed a headline scoring bug
and confirmed two fidelity points. All [APP], unit + real-capture + live-browser validated; two
fresh-context agents grounded the fixes against the reused engine + the noita.wiki.gg.

- **🔴→✅ Fast wands scored 0 DPS (`sim/metrics.ts`, commit `b38b9c0`).** A maxed-fast wand (cast
  delay driven ≤0 by Luminous Drill, recharge zeroed) gave `cycleFrames=0` → `cycleSeconds=0` →
  `projectilesPerSecond`/`sustainedDps`/`burstDps` all hit the `cycleSeconds>0 ? x : 0` guard and
  returned **0** — the *better* the wand, the more its DPS collapsed to zero. Also corrupted
  `manaSustainable` (regen = chargeSpeed×0). **Root cause of the unstable/garbage suggestions +
  "the build vanishes when I rearrange to match it"** (scores flipped across the zero boundary as
  spells nudged `fire_rate_wait`). **Fix:** floor per-shot frames at 1 (`perShotFrames =
  max(1,…)`) — Noita fires ≤1×/frame (60 casts/s) and *"treats a negative Cast Delay as 1 frame"*
  (noita.wiki.gg/Wands). All 3 metrics goldens UNCHANGED (≥6 frames/shot). The real wand now reads
  **sustainedDps 2226 HP/s, DAMAGE/SPAM S-tier** (live, 0 console errors). **Engine untouched
  (`src/engine/` 0 files)** — the fix is in our DPS interpretation layer, where the reused
  salinecitrine sim deliberately leaves DPS uncomputed.
- **✅ Wide-blast lobbed explosives flagged self-danger (`analysis/selfDanger.ts`, commit
  `00c79f1`).** The straight-line `reachOf` heuristic missed Dynamite (62.5 HP, 28px radius, flies
  far nominally), so generation suggested spamming it unflagged. A damaging blast with radius ≥
  `LARGE_BLAST_RADIUS` (24px, provisional) now flags as danger → generation's self-danger veto
  stops suggesting it. Surgical: spares Grenade (7px, a deliberate ranged warn) + bouncing-but-tiny
  Laser (3px).
- **✅ "Add Mana" + No More Shuffle verified handled (no fix needed).** Engine applies
  `MANA_REDUCE`'s −30 cost: the deck reads `manaPerCycle −15` (net mana GAIN) with it vs `+45`
  without. `NO_MORE_SHUFFLE` → the mod already reports each wand's *effective* `shuffle=false`, so
  generation already allows ordered/trigger builds. Trust the snapshot's shuffle flag; no override.
- **✅ "You have this" highlight (`ui`, commit `b587611`).** A generated build whose deck equals the
  held wand (same `wandKey`) gets a gold border + chip — so matching a shown build reads as "already
  built" instead of vanishing.

**Remaining engine gaps:** (1) ✅ **reload now OVERLAPs recharge** — FIXED 2026-06-22, see next section.
(2) **velocity/`speed_multiplier` damage** — DEFERRED with rationale (it's an *anti-proxy* for
impact-speed damage; a static model would be sign-inverted). (3) ✅ **`REF.sustainedDps` re-grounded
150→300** — FIXED 2026-06-22, see below; `MANA_PENALTY` + a full real-corpus calibration still pending.

## ✅ Engine fidelity — reload OVERLAPs recharge (2026-06-22)

`sim/metrics.ts` modeled the fire→reload cycle **additively** (`fireFrames + reloadTime`), but in
Noita **cast delay and recharge run simultaneously** and recharge starts only at deck-empty, so it
overlaps **only the final shot's cast delay** ("Cast Delay occurs simultaneously with Recharge Time…
they don't add to each other"; recharge "is only triggered after all spells… have been cast" —
noita.wiki.gg/wiki/Wands). The cycle is now `Σd_{1..S-1} + max(d_S, max(0,R))`. This **understated
DPS** on high-recharge / low-cast-delay wands; the additive model could even yield a cycle *shorter*
than the firing time on a negative recharge (latent bug, fixed by flooring R at 0). 4 metrics goldens
re-derived (snap_01 50→39, snap_02 69→41 with sustainedDps now == burstDps, snap_03 58→52, edge
30→20); **`burstDps`/`fireSeconds` are invariant** (active firing unchanged) and asserted so.
**Validated on the real BOUNCY_ORB×3 capture: sustained DPS 8.7→11.5 (+32%), cycle formula
byte-exact.** 334 tests green · typecheck/lint clean · fresh-context adversarial review independently
re-derived every number (incl. `secondsUntilStall 6.13→2.19`) → **SHIP**. [APP] `sim/metrics.ts`,
engine untouched (the fix is in our DPS-interpretation layer).

## ✅ Tier calibration — REF.sustainedDps re-grounded 150→300 (2026-06-22)

A calibration probe across a DPS spread exposed a **top-end collapse**: at `REF.sustainedDps=150`
the saturating `sat(dps,ref)` put the **entire 300–2000+ DPS range at S** (300→81/S, 2000→100/S), so
the DAMAGE/SPAM tiers couldn't tell a solid mid-game wand from an elite one — the gap the maintainer
flagged ("fast wands saturate to S"). Re-grounded `REF.sustainedDps` to **300**: S now reserved for
genuinely-elite DPS (blended-DAMAGE crosses 80 at ~450 sustained), so **100→C, 300→A, 700→S, 2000→S**.
Monotonic (proven: 0 rank inversions over 200k random pairs), so no within-pool ranking changes; only
absolute bands shift. Pinned the band intent + the calibration-robust SPAM mana-gate as new tests (an
old `bubble>grenade` fixture ordering — a low-REF artifact between two near-zero wands — was replaced
by a synthetic gate test). 337 green; fresh-context adversarial review (monotonicity + honest-test
audit) → **SHIP**. **Still provisional:** `MANA_PENALTY` + a full real-wand-corpus calibration (needs
richer `captures/` than the current fresh-run starters). [APP] `analysis/archetypes.ts`.

## ✅ Status/DoT capability channel (2026-06-22)

The raw-HP single-hit model was blind to damage-over-time (fire/poison/toxic = ~2% max-HP/s each —
the answer to tanky/boss targets). Poison/toxic is a material-STAIN status (no `poison` in any
`damage_by_type`), so it's unquantifiable from our data — the honest model is a **capability flag**:
`WandMetrics.appliesDot {fire,poison,toxic}`, detected in the recursive metrics walk from data we
have (projectile `damageByType.fire`, `castState.material`/`trail_material`, poison/acid entity paths),
default all-false (goldens-safe), recursing trigger payloads, surfaced as a DAMAGE reason for the
boss/tank lens **without changing the score** (no fabricated number). 8 new tests (detection paths +
fixture baseline: only GRENADE's `fire:0.5` flags); false-positive scan clean; fresh-context review →
**SHIP**. Honest gaps documented (no DoT-HP figure; fireblast-style pure-explosion fire missed). 345
green. [APP] `sim/metrics.ts` + `analysis/archetypes.ts`.

## ✅ Generation — modifier-stacking templates (2026-06-22)

Generation couldn't seed the meta's **multiplier engine** (modifiers BEFORE a multicast broadcast to
every spell it draws — crit ×, damage +). Added two shuffle-gated, cap-safe templates: **`multiplicative-stack`**
([modifiers…, multicast, shots…]) and a **`cheap-shot-spam`** ([modifier, cheap-shot] pairing) for
pools without a multicast. **Engine-validated before coding** (a key discipline): `[DAMAGE, CRITICAL_HIT,
BURST_3, LIGHT_BULLET×3]` does ~6× the bare multicast's sustained DPS; a grounded negative
result — crit BEFORE a trigger does NOT boost the payload (fresh cast) — so the template uses
multicast-broadcast, not pre-trigger mods. **End-to-end:** a mixed pool now tops the DAMAGE column with
a `multiplicative-stack` build lifted far above the bare multicast's **13/D** (the modifier-broadcast;
absolute tier is chassis-dependent — B on a typical chassis, S on a roomy fast one), and trigger→nuke correctly
still wins AOE. 6 new tests (template shapes + the without-mods lift + the no-multicast fallback);
surfaced in the dial copy + tier-list label (Teach rung). Fresh-context review (cap-safety + malformed-
deck + budget-starvation hand-traces) → **SHIP**. 351 green. **Remaining (Tier 2):** deeper-than-depth-1
search (polish still can't fill empty slots). [APP] `generation/templates.ts`.

## ✅ Live-QA round — digger/utility split, spread-aware DAMAGE, tight seeds (2026-06-22)

Branch merged to `main`; driving the LIVE app on a real run surfaced (and fixed) three build-quality
bugs the maintainer caught:
- **Digging/teleport = UTILITY, not damage (`cfb6109`).** A "Multiplier build" scored **S/98** off a
  single 10 HP LASER × crit × multicast with **two 0-damage DIGGERs** as filler (the template grabbed
  them as the *cheapest* projectiles, and polish kept re-adding LUMINOUS_DRILL for its 0.4 base). Fix:
  `isUtilitySpell` (curated DIG/MOBILITY) → `damageProjectilesByMana` excludes them from every
  DAMAGE/SPAM/AOE template payload AND the polish pool; `featureFill` keeps diggers (utility template).
  Tagged `TELEPORT_PROJECTILE_STATIC`. Diggers now surface under the MOBILITY (utility) tab.
- **DAMAGE is spread-aware (`1698d0e`).** The scorer ignored spread, so a tight BURST and a wide SCATTER
  with identical DPS scored identically — it literally couldn't predict the better single-target wand.
  Added an on-target fraction `REF.spreadDeg/(REF.spreadDeg+max(0,spread))` (no-op at ≤0°). BURST_2 60/A
  > SCATTER_2 51/B > SCATTER_3 44/B.
- **Generation seeds tight, clean damage builds (`09b4c68`).** multicast templates emit one seed PER
  multicast (`MULTICAST_VARIANTS=3`) so the scorer picks BURST not pool-order; `damageModifiers` drops
  spread-wideners (HEAVY_SPREAD). Live top DAMAGE build went from SCATTER_2+HEAVY_SPREAD+2×DIGGER to
  **BURST_2 + CRITICAL_HIT + LASER/LANCE/LIGHT_BULLET, spread -17**. 353 green, lint/typecheck clean.

### 🔧 SCORING REBUILD (in progress, 2026-06-22, `feat/scoring-rebuild`) — reframed from "search" to "fidelity"
The "tool scores my hand-built wands higher than its suggestions" symptom was **isolated against the
maintainer's LIVE wand** (STEP 1, read-only): the tool rated a `BURST_2 + Luminous Drill ×3` wand
**DAMAGE 60/A** while its suggestions sat at 9/D. **Maintainer ground truth: that wand is a DIGGER, not a
damage weapon — it's close range.** So it was a **SCORING-fidelity gap wearing a search gap's clothes** —
the scorer was blind to RANGE and MANA, and the generator was *correct* to keep drills out of damage decks.
Maintainer chose a full **fitness rebuild + simulator-driven exhaustive search** (transparent grounded
numbers, not heuristics). Grounded by an 8-dimension multi-agent meta audit → **[`scoring-rebuild-spec.md`](./scoring-rebuild-spec.md)**.

> 📋 **SUPERSEDED — v2 SPEC APPROVED (2026-06-25): [`scoring-model-v2-spec.md`](./scoring-model-v2-spec.md).**
> The slice-by-slice fidelity rebuild logged below (v1) hit diminishing returns; the maintainer judged the
> model **structurally** untrusted and chose a full MODEL rebuild via a fresh interview-grounded spec. v2
> replaces abstract DPS→sat→tier with **expected TTK vs wiki-cited reference enemies**, restructures archetypes
> (**DAMAGE/AOE/SPAM + first-class DIGGING**, MOBILITY→flag, DEFENSIVE dropped), models **pierce/multi-hit + DoT
> magnitude**, and makes a **15–20-build corpus harness + meta-expert sign-off** the mandatory trust gate
> (replace-in-place, harness-first; TS in-process). **The log below is now HISTORICAL context.** Next: a fresh
> review session, then implement.

- ✅ **Slice 1 — B3 range + B4 mana (`f551e77`).** `metrics.ts` gains `reachWeightedPx` (damage-weighted
  reach) + `effectiveSustainedDps` (= sustainedDps × min(1, regen/drain), mana shortfall DROPS casts per
  engine `gun.ts:333`). `scoreDamage`/`scoreSpam` multiply by `reachFraction` (full credit ≥250px) and read
  the mana-honest effective DPS; the binary `MANA_PENALTY` cliff is gone. **Identity-safe**: every ranged +
  sustainable fixture is byte-identical; only grenade's effective DPS moves (117→43.2, it out-drains). Live
  anchor: drill wand **60/A → 17/D DAMAGE, 60/A MOBILITY** (a digger ✓). 359 tests (6 new), typecheck/lint clean.
- ✅ **B1 typed damage (`c8e0429`).** `shotDamage` summed only untyped `damage`; now adds `damage_by_type`
  (slice/electricity/melee/fire/…, skip `healing`). CHAINSAW 0→12.75 HP; a whole class of weapons was
  invisible. Range factor keeps close-range melee (chainsaw) from over-rating. Grenade goldens re-derived
  (+fire-on-hit). ✅ **B2 crit-on-explosion+AoE (`2b30ade`).** crit now scales explosion + blast, not just
  the projectile (×1 no-crit ⇒ goldens-safe).
- ✅ **Exhaustive simulator-driven search (`7b9cc08`) — "run all the options".** For a small owned pool,
  enumerate EVERY cap-limited spell combination on each chassis (one meta-canonical order each), score by the
  honest fitness, keep best per archetype — provably complete. ENABLERS included (no `isUtilitySpell` ban):
  the honest scorer ranks enabler+payload high, enabler-only low. Hybrid: template+polish fallback for large
  pools. Live anchor: top DAMAGE 8/D→34/C (found BOUNCY + Luminous-Drill-as-enabler on its own). 39ms/274 sims.
  7 enumeration tests. 369 tests green.
- ✅ **B5 reach usability per-projectile (`3305fc5`).** B3's damage-weighted MEAN reach (px) let one ultra-range
  shot mask a melee deck; now `reachUsability` ∈ [0,1] clamps each projectile's reach BEFORE weighting, so a
  mostly-melee deck reads melee (anchor BOUNCY+2×DRILL 34/C→27/C). Also eslint ignores `.claude/` (review
  worktrees no longer flood `npm run lint`).
- ✅ **Reach by weapon-KIND, not ballistic distance (2026-06-24).** A fast CHAIN_BOLT wand the maintainer
  confirms is good scored DAMAGE 3/D. Root cause: `reachUsability` used ballistic `speedMax×lifetime`, which is
  UNUSABLE — proven across all 375 projectiles (CHAIN_BOLT 29px < LUMINOUS_DRILL 47px < combat-beam MEGALASER;
  Chain Bolt's range is scripted chaining, invisible to statics). Rebuilt `isCloseRangeProjectile` (`sim/metrics.ts`):
  close iff DIGS (drill-type or curated untyped beam) or MELEE (slice/melee within 16px); else RANGED (full).
  Goldens byte-safe. Live: Chain Bolt 3→12/D (reach 0.15→0.60); drill-only 5/D + chainsaw-only 1/D stay demoted
  (keystone). REACH_REF=250 retired.
- ✅ **Burst single-cast fix (2026-06-24).** A 1-cast nova read damage÷1-frame = thousands HP/s; `burstDps` now ==
  sustainedDps for a 1-shot cycle. PARTIAL — multi-shot novas still inflate; see the TOP-OPEN item below.
- ✅ **Live "page-reload" flash fixed (2026-06-24) [UI].** Shooting (mana ticks) re-fired generation every frame;
  `useGeneration` now keys off a mana-excluding signature → no regen while firing. Genuine reloads (wand switch /
  new spell) show a non-shifting overlay loader instead of a content flash.
- 📋 **Stack decision + validation strategy → [`scoring-validation-spec.md`](./scoring-validation-spec.md).** Stay
  TypeScript/local-first (correctness is a MODEL problem, not a language one — invariants #4/#9); the productive
  "API" is an importer for builds shared online + a 3-layer validation harness (sim-fidelity · archetype-routing ·
  differential ordering), all #9-compliant (no human tier labels). The salinecitrine simulator shares builds as
  spell-ID lists (our IDs) → direct import. Unblocks REF calibration via the meta's own power-curve language.
- ✅ **FIXED (2026-06-24) — burst inflation + the enabler reach-drag ranked unsustainable novas ABOVE good held
  wands.** Fix: (a) burst is now the ACHIEVABLE peak (max HP in a 1s window, recharge + MANA bounded — a
  "sustains 42 of 373" nova can no longer read 1050 HP/s); (b) DIGGING damage excluded from combat DPS
  (`combatDamage` in `sim/metrics.ts`) — a drill enabler contributes 0 offense and no longer drags a real
  payload's reach, and a pure digger is demoted by ZERO combat output (keystone now via 0-DPS, not the reach
  floor). The 0.7/0.3 DAMAGE weight stayed (sustained already dominates once burst is achievable). Live: the
  maintainer's held wand outranks every suggestion (**46/B vs 33/C**); a full-pool viability sweep found every
  build buildable + sane + safe; MOBILITY diggers read effSust 0 (no DAMAGE pollution). 378 tests; fresh-context
  reviewed. Original finding ↓
- 🔴 **(was) burst inflation + over-weighting (2026-06-24, maintainer-flagged live).** PROVEN: a multicast nova (effSust **42**, burst **1050**, "sustains 42 of 373")
  scores DAMAGE **34**, while the maintainer's held CHAIN_BOLT wand (effSust **56**, RANGED) scores **12** — the
  nova wins PURELY on its 0.3 burst term (26.6 vs 7.8 sustained). Two coordinated causes: (1) burst is an
  UNACHIEVABLE rate (damage ÷ tiny firing window) that saturates `REF.burstDps=400`; (2) the held wand's reach is
  dragged to 0.60 by the LUMINOUS_DRILL enabler's incidental 10 HP (a speed tool, not damage). **Fix plan (grounded
  in Principle 5 "damage you can pay for"; reverses the burst-raw + 0.7/0.3 decisions — maintainer-confirmed wrong):**
  (a) burst → ACHIEVABLE peak (max HP in a ~1s window, recharge + mana bounded); (b) DAMAGE becomes
  sustained-EFFECTIVE-dominant — burst a small bounded bonus that can't flip a sustained deficit; (c) exclude curated
  ENABLER/utility incidental damage (drill) from DAMAGE/reach. Validate: held CHAIN_BOLT ≥ the unsustainable novas;
  keystone (drill-only/chainsaw-only demoted) holds. THE next slice.
- 🔴 **OPEN (found driving the maintainer's live RICH run):** (1) a **cap-22 / 12-distinct-spell pool falls to
  the template path** (exhaustive is for ≤~8 distinct) — still misses optima; needs **trimmed-per-archetype
  exhaustive + beam** (task 11). (2) **explosive AoE** (Dynamite/Bomb/Grenade, real blast 63/125/73) is demoted
  by the self-danger veto (blast-in-face) — correct, but the strong AoE hides in the Unsafe band; surface it
  with a "take explosion immunity" note. (3) **a final clean-tree adversarial review** of the whole branch
  (the mid-session one got stopped after it reverted uncommitted work — see memory).
- **Calibration Qs** (REACH_REF=250, radioactive floor, healing-as-self-heal) in spec §6 — maintainer-gated.

## Tooling — recording real runs (2026-06-22)
`npm run record` (`bridge/record.mjs`) persists every distinct live snapshot to `captures/` (gitignored),
keyed by frame, surviving death/restart (the mod overwrites `snapshot.json` in place). Promote good
captures to `src/data/fixtures/` to ground/calibrate the engine on real wand complexity. `snapshot_06`
is the first real capture (a fresh-run starter setup).

## Current fixtures
- `snapshot_01.json` — starting wand `RUBBER_BALL ×2`, cap 2; **empty bag, no perks** (fresh game). `snapshot_02/03.json` — captured 2026-06-21 (modded co-op).
- `snapshot_04.json` — **HAND-AUTHORED synthetic** (M5): continues run-10 with a populated `world_seen` (shop/pedestal/perk offerings) so the provenance + Prescribe "go grab X" path renders in the browser. Not a real capture (mod world-scan is M1-T6).
- `snapshot_05.json` — **HAND-AUTHORED synthetic** (quantity fix): run-50, CHAINSAW×8 + 1 each of DIGGER/SPITTER/MINE/BOMB/NUKE/BURST_3/DAMAGE/ADD_TRIGGER, on a cap-10 chassis. Mirrors the in-game bug (DIGGER is the cheapest projectile, owned 1). Drives the no-over-cap generation test. Kept OUT of `demoRun` (it's a separate run; `demoRun` filters to the first run_id) so it doesn't bury the run-10 demo.
- `snapshot_06.json` — **REAL capture** (`npm run record`): a fresh-run starter (LIGHT_BULLET×3 + GRENADE). First non-synthetic wand fixture; richer captures get promoted from `captures/` as runs develop. run_id relabeled off the `run-10` placeholder.
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

## What's next — re-ground the engine (TOP), then finish M1, then M6

The live pipe works (mod → bridge → app, validated in-game): auto emit-on-change (M1-T1), the bridge
(M1-T5), all carried wands (M1-T2), and per-spell quantity caps are in. The headline gap is now
**engine fidelity** — the scorer doesn't model the real Noita meta (see "🔴 Engine grounding" above).

**1. Engine fidelity — Tier 0/1/2 LARGELY DONE ([APP]).** Design + cited meta in
[`docs/scoring-grounding-spec.md`](./scoring-grounding-spec.md). ✅ Tier 0 (payload-aware damage, SPAM
damage term, AoE explosion damage), ✅ crit, ✅ **reload-overlap cycle** (2026-06-22), ✅ **REF.sustainedDps
re-grounding**, ✅ **status/DoT capability flag**, ✅ chassis-selection, ✅ **modifier-stacking
generation templates** (the multiplier engine). **Remaining, in priority:**
- **REF/MANA_PENALTY full calibration** against a real-wand CORPUS — blocked on richer `captures/` (the
  committed fixtures are all ≤117 DPS fresh-run starters); needs the maintainer to `npm run record` a
  spread of real wands across the power curve.
- **Velocity damage** — DEFERRED with rationale (anti-proxy; needs a projectile-table regen with
  air_friction/gravity/mass + impact-distance modeling). The only Tier-1 magnitude gap left.
- **Deeper generation search / fill-empty-slots** — DEFERRED: probed low-value under the current
  single-payload-per-cast DPS model (filling a trigger seed's empties doesn't raise its score). Revisit
  after multi-payload modeling.
- **Investigated + deferred (2026-06-22, low-value/blocked):** a `max_uses` spam down-weight — our sim
  is single-cycle so `max_uses≥1` only depletes in wrapping redraws (narrow), and a scoring hack would
  pre-empt the correct fix (thread `max_uses` into the engine, which already supports `uses_remaining`);
  gravity-based lobbed self-danger — needs a projectile-table regen (risks rippling all damage goldens)
  for marginal gain over the shipped `LARGE_BLAST_RADIUS` rule. Neither warranted a change.

**2. ✅ DONE — Per-spell quantity ([APP]).** Owned-count caps; `uses_remaining < 0 → null`. Writeup
under "✅ FIXED" above. Phase 2 (owned + seen-in-world counts) unblocked by M1-T6.

**3. Finish M1** (mostly [MOD] human-in-the-loop — implement thin Lua → STOP → hand a copy-paste
in-game test → user verifies): real `run_id` = world seed (M1-T3), Advanced Spell Inventory compat
(M1-T4), the additive **world-scan** — shop/pedestal/Holy-Mountain (M1-T6) → makes provenance + "go
grab X" live. ✅ M1-T1/T2/T5 done.

**4. M6 — Tauri v2 overlay** once the above settles. Calibration (M4 REF constants, generation
bounds) is now unblocked — real wands can be captured live (`npm run record`).
- **M6 — Tauri v2 overlay** — defer until live data flows (the overlay shows the live assistant
  in-game; pointless before M1).
- **Calibration** (M4 REF constants, generation bounds) needs real wands → after M1 captures land.

Start M1 in a **fresh session** (this one is context-heavy); the mod is the untestable piece.

Two product asks captured during M2 (do NOT lose):
- **Real icons** "from the actual run" — M1 mod must export `sprite_base64` (item 5 above); app is already sprite-ready.
- **No pagination / best wands on one page** — honored in the M2 layout; M4/M5 tier list drops into the "Best Builds" slot, not a separate page.

**Deferred to M1** (human-loop, logged above): quant.ew perk read, Advanced Spell Inventory spells, all-4-wands enumeration, real `run_id`, and the **world-scan slice (M1-T6)** — "nearby" / shop / pedestal / Holy-Mountain wands, spells, and perk offerings. The optional `world_seen` field already exists in the snapshot schema, so the app can ingest it now; **capturing** it is M1-T6 (test standing in a shop / Holy Mountain, [MOD]), and **using** it as the "seen-in-world" pool is M5. Exact shape (shop spells vs shop/pedestal wands vs floor drops) gets pinned against real captures then. Do when richer live data is needed.
