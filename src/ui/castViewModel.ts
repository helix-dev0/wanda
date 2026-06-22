// M3-T4 — pure view-model for the cast simulation. Simulates the wand, derives
// metrics, and normalizes the engine's grouped cast output into a renderable
// tree. No React/DOM here so it's unit-tested in node; the components stay thin.

import type { Wand } from '../schema/snapshot'
import { spellTile, type SpellTileModel } from './viewModel'
import { formatFrames, formatSpread } from './format'
import { simulateWand } from '../sim/simulateWand'
import { computeMetrics, type WandMetrics } from '../sim/metrics'
import { condenseActionsAndProjectiles } from '../engine/eval/condense'
import type { GroupedProjectile } from '../engine/eval/types'
import {
  isArrayObject,
  isMultipleObject,
  type GroupedObject,
} from '../engine/util/combineGroups'

export interface CastNodeView {
  key: string
  /** Source spell action id (for the type-coloured tile), or null if unresolved. */
  id: string | null
  entity: string
  /** How many identical projectiles this node represents (engine grouping). */
  count: number
  tile: SpellTileModel
  /** Trigger payload projectiles (nested cast), if this projectile triggers. */
  children: CastNodeView[]
}

export interface CastShotView {
  /** 1-based shot number within the fire-until-reload cycle. */
  index: number
  manaDrain: number | null
  projectiles: CastNodeView[]
}

export interface MetricRow {
  key: string
  label: string
  value: string
  /** Rendered with an "approx" affordance (the damage model is approximate). */
  approximate?: boolean
}

export interface CastView {
  slot: number
  title: string
  /** True when the wand produces no shots (empty deck / all-modded). */
  empty: boolean
  /** Simulation is not a faithful reproduction (modded spells / always-cast / missing damage data). */
  approximate: boolean
  missingSpells: string[]
  shots: CastShotView[]
  metrics: MetricRow[]
}

// Flatten the engine's GroupedObject tree (raw | {first,count} | array) into
// renderable nodes, accumulating the repeat count. Exercises condense/combineGroups.
function projectileNodes(
  group: GroupedObject<GroupedProjectile>,
  count: number,
  path: string,
): CastNodeView[] {
  if (isArrayObject(group)) {
    return group.flatMap((g, i) => projectileNodes(g, count, `${path}.${i}`))
  }
  if (isMultipleObject(group)) {
    return projectileNodes(group.first, count * group.count, path)
  }
  const proj = group // raw GroupedProjectile
  const id = proj.action?.id ?? null
  const children = proj.trigger
    ? projectileNodes(proj.trigger.projectiles, 1, `${path}.t`)
    : []
  return [{ key: path, id, entity: proj.entity, count, tile: spellTile(id), children }]
}

function metricRows(m: WandMetrics): MetricRow[] {
  const dps = (n: number) => `${n.toFixed(1)} HP/s`
  const mana = m.manaSustainable
    ? 'Sustainable'
    : m.secondsUntilStall != null
      ? `Stalls in ${m.secondsUntilStall.toFixed(1)}s`
      : 'Stalls'
  return [
    { key: 'sustainedDps', label: 'Sustained DPS', value: dps(m.sustainedDps), approximate: true },
    { key: 'burstDps', label: 'Burst DPS', value: dps(m.burstDps), approximate: true },
    { key: 'damagePerCast', label: 'Damage / cast', value: `${Math.round(m.damagePerCast)} HP`, approximate: true },
    { key: 'projPerSec', label: 'Projectiles / s', value: m.projectilesPerSecond.toFixed(1) },
    { key: 'shots', label: 'Shots / reload', value: m.truncated ? `${m.shotsUntilReload}+` : String(m.shotsUntilReload) },
    { key: 'cycle', label: 'Cycle time', value: formatFrames(m.cycleFrames) },
    { key: 'mana', label: 'Mana', value: mana },
    { key: 'spread', label: 'Spread', value: formatSpread(m.effectiveSpread) },
    { key: 'aoe', label: 'AoE radius', value: m.maxExplosionRadius > 0 ? `${Math.round(m.maxExplosionRadius)} px` : '—' },
  ]
}

/** Simulate a wand and build the full renderable cast view (tree + metrics). */
export function castView(wand: Wand): CastView {
  const slot = wand.slot
  const sim = simulateWand(wand)
  const metrics = computeMetrics(sim.shots, sim.reloadTime, wand.stats, sim.hitIterationLimit)

  const shots: CastShotView[] = sim.shots.map((shot, i) => {
    const grouped = condenseActionsAndProjectiles(shot)
    return {
      index: i + 1,
      manaDrain: shot.manaDrain ?? null,
      projectiles: projectileNodes(grouped.projectiles, 1, `s${i}`),
    }
  })

  return {
    slot,
    title: slot === 0 ? 'Held wand' : `Wand · slot ${slot}`,
    empty: sim.shots.length === 0,
    approximate: sim.approximate || metrics.damageApproximate,
    missingSpells: sim.missingSpells,
    shots,
    metrics: metricRows(metrics),
  }
}
