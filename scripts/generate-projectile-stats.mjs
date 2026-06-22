#!/usr/bin/env node
// Generate src/sim/data/projectileStats.generated.ts from Noita's projectile
// XMLs. The vendored cast engine (src/engine) tells us WHICH projectile entities
// a wand fires, but carries no base-damage numbers; this table supplies them so
// the metrics layer can compute absolute damage. See src/sim/data/README.md.
//
// Source of truth: <ProjectileComponent damage="..."> in data/entities/projectiles/**
// (unit 1.0 = 25 HP). Explosions are a separate <config_explosion damage/explosion_radius>.
// We resolve <Base file="data/..."> inheritance (base = defaults, child overrides).
//
// Usage (one-time / on game update):
//   NOITA_DATA=/path/to/data node scripts/generate-projectile-stats.mjs
// Default root is ./.noita-data (a sparse clone of github.com/vexx32/noita-data,
// whose repo root maps to the game's `data/` dir). The committed output makes
// `npm test` fully offline.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { XMLParser } from 'fast-xml-parser'

const DATA_ROOT = resolve(process.env.NOITA_DATA ?? process.argv[2] ?? './.noita-data')
const PROJECTILE_DIR = join(DATA_ROOT, 'entities/projectiles')
const OUT = resolve('src/sim/data/projectileStats.generated.ts')

if (!existsSync(PROJECTILE_DIR)) {
  console.error(
    `[generate-projectile-stats] not found: ${PROJECTILE_DIR}\n` +
      `Point NOITA_DATA at the game's data/ dir, or sparse-clone the mirror:\n` +
      `  git clone --depth 1 --filter=blob:none --sparse https://github.com/vexx32/noita-data .noita-data\n` +
      `  cd .noita-data && git sparse-checkout set entities/projectiles`,
  )
  process.exit(1)
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

const toArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x])
const firstOf = (x) => (Array.isArray(x) ? x[0] : x)
const num = (v, dflt) => {
  if (v == null) return dflt
  const n = Number.parseFloat(String(v).trim())
  return Number.isNaN(n) ? dflt : n
}

/** All `@_`-prefixed attributes of a parsed element → { name: value } (prefix stripped). */
function attrsOf(node) {
  const out = {}
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      if (k.startsWith('@_')) out[k.slice(2)] = node[k]
    }
  }
  return out
}

/** Extract a node's own ProjectileComponent (attrs + nested explosion/damage_by_type), or null. */
function extractProjectile(node) {
  const pc = firstOf(node?.ProjectileComponent)
  if (!pc) return null
  const ce = firstOf(pc.config_explosion)
  const dbt = firstOf(pc.damage_by_type)
  return {
    attrs: attrsOf(pc),
    explosion: ce ? attrsOf(ce) : null,
    damageByType: dbt ? attrsOf(dbt) : null,
  }
}

function mergeInto(acc, part) {
  if (!part) return
  acc.found = true
  Object.assign(acc.attrs, part.attrs)
  if (part.explosion) acc.explosion = { ...(acc.explosion ?? {}), ...part.explosion }
  if (part.damageByType) acc.damageByType = { ...(acc.damageByType ?? {}), ...part.damageByType }
}

/** Resolve a Noita `data/...`-rooted path against DATA_ROOT. */
function resolveDataPath(file) {
  const rel = file.replace(/^data\//, '')
  return join(DATA_ROOT, rel)
}

/**
 * Effective ProjectileComponent for an Entity, walking <Base> inheritance:
 * base file first (defaults), then overrides nested inside the <Base> tag, then
 * the entity's own components. Later writes win (Object.assign).
 */
function effectiveProjectile(entity, seen) {
  const acc = { attrs: {}, explosion: null, damageByType: null, found: false }
  for (const base of toArray(entity.Base)) {
    const file = base?.['@_file']
    if (file) {
      const abs = resolveDataPath(file)
      if (existsSync(abs) && !seen.has(abs)) {
        seen.add(abs)
        const parsed = parseEntity(abs)
        if (parsed) mergeInto(acc, effectiveProjectile(parsed, seen))
      }
    }
    mergeInto(acc, extractProjectile(base)) // overrides declared inside <Base>
  }
  mergeInto(acc, extractProjectile(entity))
  return acc
}

function parseEntity(absPath) {
  try {
    const root = parser.parse(readFileSync(absPath, 'utf8'))
    return firstOf(root.Entity) ?? null
  } catch (err) {
    console.warn(`[generate-projectile-stats] parse failed: ${absPath}: ${err.message}`)
    return null
  }
}

function walkXml(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walkXml(p))
    else if (e.isFile() && e.name.endsWith('.xml')) out.push(p)
  }
  return out
}

// --- build the table ---------------------------------------------------------
const files = walkXml(PROJECTILE_DIR).sort()
const table = {}
let skipped = 0

for (const abs of files) {
  const entity = parseEntity(abs)
  if (!entity) {
    skipped++
    continue
  }
  const eff = effectiveProjectile(entity, new Set([abs]))
  if (!eff.found) {
    skipped++ // no ProjectileComponent anywhere in the chain — not a damaging projectile
    continue
  }
  const key = 'data/' + relative(DATA_ROOT, abs).split('\\').join('/')
  const a = eff.attrs
  const stats = {
    // Game default for an unspecified `damage` on a present ProjectileComponent is 1.0.
    damage: a.damage != null ? num(a.damage, 1) : 1,
    explosionDamage: eff.explosion ? num(eff.explosion.damage, 0) : 0,
    explosionRadius: eff.explosion ? num(eff.explosion.explosion_radius, 0) : 0,
    lifetime: num(a.lifetime, 0),
    speedMin: num(a.speed_min, 0),
    speedMax: num(a.speed_max, 0),
    bouncesLeft: num(a.bounces_left, 0),
  }
  if (eff.damageByType) {
    const dbt = {}
    for (const [k, v] of Object.entries(eff.damageByType)) {
      const n = num(v, null)
      if (n != null) dbt[k] = n
    }
    if (Object.keys(dbt).length > 0) stats.damageByType = dbt
  }
  table[key] = stats
}

// deterministic key order for stable diffs
const sorted = {}
for (const k of Object.keys(table).sort()) sorted[k] = table[k]

const header = `// AUTO-GENERATED by scripts/generate-projectile-stats.mjs — DO NOT EDIT.
//
// Per-projectile base stats extracted from Noita's projectile XMLs
// (data/entities/projectiles/**). Damage is in the game's internal unit where
// 1.0 = 25 HP. \`explosion*\` come from the projectile's <config_explosion>.
// Keyed by the same entity path the engine emits as WandShot.projectiles[i].entity.
// See src/sim/data/README.md for provenance, the license caveat, and how to regen.

import type { ProjectileStats } from './projectileStats'

export const projectileStatsTable: Record<string, ProjectileStats> = `

writeFileSync(OUT, header + JSON.stringify(sorted, null, 2) + '\n')
console.log(
  `[generate-projectile-stats] wrote ${Object.keys(sorted).length} entries to ${relative(process.cwd(), OUT)} (${skipped} files skipped, no ProjectileComponent)`,
)
