# `src/engine` — vendored Noita wand-simulator core

This directory is a **vendored fork** of the wand-cast simulation core from
[`salinecitrine/noita-wand-simulator`](https://github.com/salinecitrine/noita-wand-simulator),
specifically its framework-agnostic `src/app/calc/` engine. It is the source of
truth for cast mechanics per CLAUDE.md invariant #4 (do **not** rewrite the
simulator from scratch). The engine logic is kept **byte-faithful** — only the
small coupling to the upstream app was stripped (see "Coupling changes").

## Provenance

- **Upstream:** `github.com/salinecitrine/noita-wand-simulator`, path `src/app/calc/`.
- **Commit vendored:** `043f568ff2af6069a46032764735805a4f326a12`.
- **Vendored at:** M3-T1 (2026-06-21).
- `calc/gun.ts` is itself a line-by-line port of Noita's own `gun.lua`; the
  `__generated__/` tables are produced upstream by a build-time Python script
  (`scripts/generate_gun_actions.py`) from the game's `gun_actions.lua`.

## License caveat (READ BEFORE DISTRIBUTING)

The upstream repository ships **no LICENSE file**, which under copyright law
means **all rights reserved**. Per the approved project plan
(`docs/plan.md`, M3 architecture decision 1) this is **accepted for this
personal, non-distributed project only**.

> **Caveat:** If this project is ever published or distributed, you must first
> obtain an explicit license grant from `salinecitrine`. Do not ship this code
> publicly without that grant.

## Public entry points

The two functions the rest of the app should call:

### `clickWand(...)` — `eval/clickWand.ts`

Simulates clicking a wand and returns the resulting shots.

```ts
function clickWand(
  wand: Gun,
  spells: Action[],
  mana: number,
  castDelay: number,
  fireUntilReload: boolean,
  endOnRefresh: boolean,
  requirements?: Requirements,
): [WandShot[], number | undefined, boolean]
// returns [shots, reloadTime, hitIterationLimit]
```

- `wand: Gun` — `{ actions_per_round, shuffle_deck_when_empty, reload_time, deck_capacity }`.
- `spells: Action[]` — the **full `Action` objects** (not bare ids), in slot
  order, with `null`/`undefined` for empty slots. Get them from the generated
  table via `getActionById(id)` from `eval/util.ts`. Each `Action.uses_remaining`
  is honored. **(M3-T2 will add a runtime spell-DB → `Action` adapter so our
  mod's dumped `gun_actions.lua` can feed this; today the source is the vendored
  generated table.)**
- `mana` — current wand mana. `castDelay` — cast delay (`fire_rate_wait`).
- `fireUntilReload` — keep firing shots until a reload (capped at 10 iterations).
- `endOnRefresh` — stop when a `RESET` action fires.
- `requirements?` — optional `{ enemies, projectiles, hp, half }` to force
  conditional (`IF_*`) spell branches for analysis.

### `condenseActionsAndProjectiles(wandShot)` — `eval/condense.ts`

Collapses a `WandShot`'s repeated actions/projectiles into grouped form for
display (e.g. `12x light_bullet`).

```ts
function condenseActionsAndProjectiles(wandShot: WandShot): GroupedWandShot
```

Other useful exports: `getActionById(id)` (`eval/util.ts`), the `actions` table
(`__generated__/gun_actions.ts`), and the action-type constants
(`gun_enums.ts`). Types live in `eval/types.ts` and `extra/types.ts`.

## Coupling changes (the only edits to upstream logic)

1. **Redux store → `config.ts` (the one app coupling).** Upstream
   `extra/util.ts` imported `store` from `'../../redux/store'` and read
   `config.config.random.worldSeed` / `.frameNumber` to seed the RNG. Replaced
   with a tiny mutable module **`src/engine/config.ts`** (`engineConfig` +
   `setEngineConfig`); `extra/util.ts` now reads `engineConfig.worldSeed` /
   `.frameNumber`. Both default to `0`. **`config.ts` is the only house-authored
   file in this directory** (and is therefore still linted — see below).
2. **Vendored two util files into `util/`.** Upstream `calc/` imported from
   `'../../util/util'` and `'../../util/combineGroups'`. Both are copied to
   `src/engine/util/` and the import paths in `eval/lookups.ts`,
   `eval/condense.ts`, `eval/types.ts` updated to `'../util/...'`.
   - `util/util.ts`: the upstream `Preset`/`PresetGroup` types (from the app's
     `types.ts`, which pulls in Redux + a full `Wand` type) are only referenced
     by two dead-code helpers (`isSinglePreset`/`isPresetGroup`) the engine never
     calls. They are inlined locally as minimal structural types so the file is
     self-contained. The `'../calc/gun_enums'` import became `'../gun_enums'`.
   - `util/combineGroups.ts`: vendored; the one deep-equality call uses
     `fast-deep-equal` (see below). Now covered by `__tests__/combineGroups.test.ts`.
3. **`fast-deep-equal`** is the engine's only runtime dependency, used for
   `combineGroups.ts`'s single deep-equality check (one `equal(a, b)` call).
   Upstream used `lodash` `_.isEqual`; swapped post-port because lodash carries a
   **high-severity advisory** (`_.template`/`_.unset`/`_.omit` — paths we never
   use) and is a heavy dep for one function, and the version originally resolved
   here (`4.18.1`) does not exist on public npm (would break `npm install` on the
   maintainer's + co-player's machines). `fast-deep-equal` is a zero-dependency,
   advisory-free drop-in with identical semantics for this plain-object data;
   `npm audit` is clean. Behaviour verified by `__tests__/combineGroups.test.ts`.

## Strict-mode / lint concessions (documented per task)

The upstream engine compiled under Create-React-App's looser tsconfig. To make
it pass our strict TS 6 + ESLint config **without changing any algorithm**:

- **`import type` everywhere.** `verbatimModuleSyntax` requires type-only
  imports to be marked. Applied across all engine + generated files. This is a
  correctness-neutral typing fix; the logic files (`gun.ts`, `eval/`, `extra/`)
  remain genuinely type-checked.
- **`enum ActionSource` → erasable const-object + union type** (`eval/types.ts`),
  required by `erasableSyntaxOnly`. Runtime values are identical
  (`ActionSource.DRAW === 'draw'`).
- **`tsconfig.engine.json`** type-checks `src/engine/` with `noUnusedLocals` and
  `noUnusedParameters` **relaxed** (all other strictness — null checks,
  implicit-any, `verbatimModuleSyntax`, `erasableSyntaxOnly` — stays ON). The
  byte-faithful port of `gun.lua` keeps several write-only state mirrors (e.g.
  `state_shuffled`) and the generated action lambdas have many unused `c`
  params; flagging those would force unfaithful edits. `tsconfig.app.json`
  excludes `src/engine`; the root `tsconfig.json` references the engine project.
- **`util/combineGroups.ts` has a `// @ts-nocheck` pragma.** Its
  `GroupedObject<T extends Object>` generic recursion trips our generic-constraint
  and null checks (TS2344/TS2345/TS2322) — pre-existing typing artifacts, not
  logic bugs (the algorithm is proven by the ported tests). This single vendored
  file is exempted; its exported types are still consumed normally by callers.
- **ESLint ignores `src/engine/**`** (vendored third-party code isn't held to
  our house style) — **except `src/engine/config.ts`**, which is house-authored
  and stays linted. See `eslint.config.js`.

## Tests (characterization proof of a faithful port)

The upstream `__tests__/` are ported to Vitest (jest→vitest: explicit
`import { describe, it, expect, vi } from 'vitest'`, `jest.*` → `vi.*`) and live
under `src/engine/__tests__/`. They are unchanged in logic and serve as the
characterization proof that the port reproduces upstream behavior:

- `gun.test.ts` — deck draw/reload/discard mechanics (uses `vi.spyOn`).
- `clickWand.test.ts` — trigger + multi-shot projectile trees (also exports
  `defaultGun`/`wandShotToProjectiles` used by the requirements suite).
- `random.test.ts` — RNG seeding.
- `spells/requirements.test.ts` — `IF_ENEMY` / `IF_ELSE` / `IF_END` branching.

Run with `npm test -- src/engine`.
