# Progress & status

> Living status doc. Companion to [`plan.md`](./plan.md) (the milestone breakdown) and
> [`../noita-wand-assistant-spec.md`](../noita-wand-assistant-spec.md) (the design).
> **Last updated: 2026-06-21** · branch `feat/m2-mirror` (off `master`; M0 merged to `master`).

## Milestone status

| Milestone | Status | Notes |
|---|---|---|
| **M0 — Fixtures & schema** | ✅ **COMPLETE** (T1–T5) | App is now buildable against fixtures with zero further game access through M5. |
| M1 — Extraction mod + bridge | ⬜ not started | Evolve the M0 capture seed into the real emit-on-change mod + live bridge. |
| **M2 — Ingestion + store + mirror UI** | ✅ **COMPLETE** (T1–T4) | First **visible** milestone — single-page wand-mirror dashboard, fixture-driven + browser-verified. |
| M3 — Simulator integration | ⬜ | Fork `salinecitrine` `calc/`; adapt to our runtime spell-DB dump. |
| M4 — Analysis engine | ⬜ | Archetype scoring + self-danger (perk-aware) + local search → **tier list per type** for held wands. |
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
- **Verified:** 92 unit tests pass · typecheck · lint · production build all clean. Browser-verified (Playwright) across all 3 fixtures — stats incl. negative spread, the GRENADE null slot, the 2×NUKE bag, and pool accumulation 1→3→4; zero console errors. Data source = recorded fixtures via `src/data/demoRun.ts` (`?capture=N` dev override); the live bridge replaces it at M1-T5.

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

## What's next — M3 (M2 ✅ complete)

**Active next step: M3 — simulator integration** (mostly [APP]; one [MOD] spot-check). Fork `salinecitrine/noita-wand-simulator`'s `src/app/calc/` into `src/engine/`, then adapt it to ingest our runtime spell-DB dump (the build-time-vs-runtime reconciliation — see plan M3-T1/T2). Then derive metrics (M3-T3) and render the cast tree (M3-T4) into the existing dashboard's reserved **"Best Builds"** slot, keeping the **grimoire × wand-edit** visual identity (see memory `ui-visual-direction`). Build in a **fresh session** (this one is context-heavy).

The dashboard is ready for M3+: `runStore.ledger` is the pool the analysis/generation will consume; the UI has a marked slot for ranked output; spell/perk lookups + formatters exist in `src/data` + `src/ui/format.ts`.

Two product asks captured during M2 (do NOT lose):
- **Real icons** "from the actual run" — M1 mod must export `sprite_base64` (item 5 above); app is already sprite-ready.
- **No pagination / best wands on one page** — honored in the M2 layout; M4/M5 tier list drops into the "Best Builds" slot, not a separate page.

**Deferred to M1** (human-loop, logged above): quant.ew perk read, Advanced Spell Inventory spells, all-4-wands enumeration, real `run_id`, and the **world-scan slice (M1-T6)** — "nearby" / shop / pedestal / Holy-Mountain wands, spells, and perk offerings. The optional `world_seen` field already exists in the snapshot schema, so the app can ingest it now; **capturing** it is M1-T6 (test standing in a shop / Holy Mountain, [MOD]), and **using** it as the "seen-in-world" pool is M5. Exact shape (shop spells vs shop/pedestal wands vs floor drops) gets pinned against real captures then. Do when richer live data is needed.
