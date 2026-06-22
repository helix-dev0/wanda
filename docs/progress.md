# Progress & status

> Living status doc. Companion to [`plan.md`](./plan.md) (the milestone breakdown) and
> [`../noita-wand-assistant-spec.md`](../noita-wand-assistant-spec.md) (the design).
> **Last updated: 2026-06-21** · branch `feat/m0-fixtures-schema` (off `master`).

## Milestone status

| Milestone | Status | Notes |
|---|---|---|
| **M0 — Fixtures & schema** | ✅ **COMPLETE** (T1–T5) | App is now buildable against fixtures with zero further game access through M5. |
| M1 — Extraction mod + bridge | ⬜ not started | Evolve the M0 capture seed into the real emit-on-change mod + live bridge. |
| M2 — Ingestion + store + mirror UI | ⬜ not started | First **visible** milestone (wand mirror in the browser). M1 & M2 can run in parallel. |
| M3 — Simulator integration | ⬜ | Fork `salinecitrine` `calc/`; adapt to our runtime spell-DB dump. |
| M4 — Analysis engine | ⬜ | Archetype scoring + self-danger (perk-aware) + local search. |
| M5 — Generation engine | ⬜ | Template-seeded build generation. |
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

## Current fixtures (captured 2026-06-21)
- `snapshot_01.json` — starting wand `RUBBER_BALL ×2`, cap 2; **empty bag, no perks** (fresh game).
- `spell_db.json` — 422 spells. `perk_db.json` — 105 perks. (Captured in the maintainer's **modded** setup, not pristine vanilla — see open items.)

## Open items / flags carried forward
1. **Fixture coverage is thin** — 1 simple wand, no loose spells, no perks. Need a richer capture (varied wands, loose spells, perks) for meaningful M2–M5 work.
2. **Spell-bag read unconfirmed** — bag was empty (new game), so we can't yet tell if the `inventory_full` child read works. A capture *with loose spells* confirms it.
3. **Perk capture + stack counts unconfirmed** — no perks picked yet. `PERK_PICKED_<id>_PICKUP_COUNT` may not exist on this build (sources disagreed); the mod reads it with a default of `1`.
4. **Diagnostics don't log** — Noita's *release* build doesn't route Lua `print()` to `logger.txt`. Use `GamePrint` or write a diagnostics file for any future in-game probes.
5. **Modded vs vanilla** — fixtures reflect the maintainer's real modded co-op env (quant.ew etc.). Fine by the DB-from-game design; a clean vanilla capture may still help M3 engine validation + the bundled fallback.

## What's next
- **Recommended:** one richer capture (mid-run: ~5 varied wands, loose spells in bag, a perk or two) to give M2–M5 real coverage and close flags #2/#3. Output lands in the Noita install dir; can be read straight off disk.
- Then **M2** (ingestion + run-state store + wand-mirror UI) — the first visible milestone — and/or **M1** (real mod + live bridge), which can proceed in parallel.
