# `src/sim/data` — projectile base-stats table

The vendored cast engine (`src/engine/`) simulates a wand's cast *structure* and
accumulates modifier *deltas* (`GunActionState.damage_*_add`), but it carries **no
projectile base-damage numbers** — `__generated__/entityProjectileMap.ts` is only
an entity-path → action-id name map. To compute absolute damage / DPS (spec §6.1)
the metrics layer needs each projectile's base stats. This directory supplies them.

## Files

- **`projectileStats.generated.ts`** — the build-time-generated table
  (`Record<entityPath, ProjectileStats>`), keyed by the same paths the engine emits
  as `WandShot.projectiles[i].entity`. **Do not edit by hand** (regenerate instead).
  ESLint-ignored (mechanical/generated); still type-checked.
- **`projectileStats.ts`** — house-authored: the `ProjectileStats` type, the
  `DAMAGE_UNIT_HP` constant, and `getProjectileStats(entity)` lookup.
- **`projectileStats.test.ts`** — characterization tests pinning known game values.

## Provenance & the damage unit

Stats are extracted from Noita's projectile XMLs (`data/entities/projectiles/**`):
`<ProjectileComponent damage="...">` for direct damage, and the nested
`<config_explosion damage/explosion_radius>` for explosions. Noita's internal
damage unit is **`1.0 = 25 HP`** (verified: Spark Bolt's `light_bullet` is
`damage="0.12"` ≈ 3 HP; the DAMAGE card's `+0.4` = +10 HP). The engine's
`damage_*_add` modifiers are additive deltas in this **same** unit, so the metrics
layer does `(base + damage_projectile_add) × 25` for HP. Explosions are a separate
source modified by `damage_explosion_add`.

`<Base file="data/...">` inheritance is resolved (base = defaults, child overrides).

## License caveat (READ BEFORE DISTRIBUTING)

The generated numbers are **derived from Nolla Games' copyrighted game data**. Per
the approved project plan this is **accepted for this personal, non-distributed
project only** — mirroring the vendored-engine caveat in `src/engine/README.md`.
Only the small derived numeric table is committed; the raw game XMLs are **not**.

> If this project is ever published/distributed, review the licensing of any
> bundled game-derived data first.

## Regenerating (one-time / on game update)

The table is committed, so `npm test` is fully offline — you only regenerate when
the game data changes. The generator reads a game-`data/`-rooted directory:

```sh
# Option A — public mirror (repo root == the game's data/ dir):
git clone --depth 1 --filter=blob:none --sparse https://github.com/vexx32/noita-data .noita-data
cd .noita-data && git sparse-checkout set entities/projectiles && cd ..
node scripts/generate-projectile-stats.mjs          # defaults to ./.noita-data

# Option B — the maintainer's own unpacked game data (authoritative):
NOITA_DATA=/path/to/Noita/data node scripts/generate-projectile-stats.mjs
```

`.noita-data/` is gitignored. Commit only the regenerated
`projectileStats.generated.ts`; the characterization test guards against
accidental value drift.
