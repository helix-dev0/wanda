import { describe, it, expect, beforeEach } from 'vitest'
import { generate } from './generate'
import { clearSimCache } from '../analysis/simCache'
import { deckFeatureCounts } from '../analysis/features/spellFeatures'
import { BUILDS_PER_ARCHETYPE } from './budget'
import { spellDb } from '../data/spellDb'
import { ARCHETYPES } from '../analysis'
import { ownedCounts } from '../store/runStore'
import { ingestSnapshot } from '../ingestion/ingest'
import type { Wand, WandStats, Snapshot } from '../schema/snapshot'
import type { GenerateRequest } from './types'

const fixtures = import.meta.glob('../data/fixtures/snapshot_*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>
const loadSnap = (suffix: string): Snapshot => {
  const key = Object.keys(fixtures).find((k) => k.endsWith('/' + suffix))
  if (!key) throw new Error(`fixture not found: ${suffix}`)
  const r = ingestSnapshot(fixtures[key])
  if (!r.ok) throw new Error(`fixture failed to ingest: ${suffix}`)
  return r.snapshot
}
const deckTally = (w: Wand): Map<string, number> => {
  const m = new Map<string, number>()
  for (const s of w.spells) if (s !== null) m.set(s, (m.get(s) ?? 0) + 1)
  return m
}

const stats = (over: Partial<WandStats> = {}): WandStats => ({
  shuffle: false,
  spellsPerCast: 1,
  castDelay: 10,
  rechargeTime: 30,
  manaMax: 500,
  mana: 500,
  manaChargeSpeed: 200,
  capacity: 6,
  spread: 0,
  speedMultiplier: 1,
  ...over,
})
const chassis = (over: Partial<WandStats> = {}): Wand => ({
  slot: 0,
  stats: stats(over),
  always_cast: [],
  spells: [],
})

// owned + seen pool (mirrors the synthetic snapshot_04 demo)
const POOL = ['LIGHT_BULLET', 'ADD_TRIGGER', 'BOMB', 'DAMAGE', 'NUKE', 'CHAINSAW', 'LUMINOUS_DRILL']
const req = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  pool: POOL,
  chassis: chassis(),
  perks: [],
  constraints: {},
  ...over,
})

const allBuilds = (r: ReturnType<typeof generate>) => Object.values(r).flatMap((a) => a.builds)
const hasTemplate = (r: ReturnType<typeof generate>, t: string) =>
  allBuilds(r).some((b) => b.template === t)
const deckHasDig = (w: Wand) => deckFeatureCounts(w).DIG > 0

beforeEach(() => clearSimCache())

describe('generate — template-seeded + polished builds', () => {
  it('produces builds for offensive archetypes, ranked by target score', () => {
    const r = generate(req())
    expect(r.DAMAGE.builds.length).toBeGreaterThan(0)
    expect(r.SPAM.builds.length).toBeGreaterThan(0)
    const scores = r.DAMAGE.builds.map((b) => b.analysis.scores.DAMAGE.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    expect(r.DAMAGE.builds[0].archetype).toBe('DAMAGE')
    expect(r.DAMAGE.builds[0].template).toBeTruthy()
  })

  it('is deterministic — same request yields a deep-equal result', () => {
    const a = generate(req())
    clearSimCache()
    const b = generate(req())
    expect(b).toEqual(a)
  })

  it('caps builds per archetype', () => {
    for (const a of Object.values(generate(req()))) {
      expect(a.builds.length).toBeLessThanOrEqual(BUILDS_PER_ARCHETYPE)
    }
  })

  it('only applies score-improving edits when the pool has no self-hazards', () => {
    // no nuke/bomb/explosion → no hazards → every polish step is a pure score gain
    const r = generate(req({ pool: ['LIGHT_BULLET', 'DAMAGE', 'DIGGER', 'CHAINSAW'] }))
    for (const b of allBuilds(r)) for (const e of b.edits) expect(e.deltaScore).toBeGreaterThanOrEqual(1)
  })

  it('notes an empty pool instead of crashing', () => {
    const r = generate(req({ pool: [] }))
    expect(r.DAMAGE.builds).toEqual([])
    expect(r.DAMAGE.note).toMatch(/no spells/i)
  })

  it('explains an archetype it cannot build (no defensive spells in pool)', () => {
    const r = generate(req())
    expect(r.DEFENSIVE.builds).toEqual([])
    expect(r.DEFENSIVE.note).toMatch(/defensive/i)
  })
})

describe('generate — shuffle gating', () => {
  it('seeds order-dependent trigger→payload only on a non-shuffle chassis', () => {
    const nonShuffle = generate(req())
    clearSimCache()
    const shuffle = generate(req({ chassis: chassis({ shuffle: true }) }))
    expect(hasTemplate(nonShuffle, 'trigger-payload')).toBe(true)
    expect(hasTemplate(shuffle, 'trigger-payload')).toBe(false)
  })
})

describe('generate — full-DB theorycraft pool stays bounded', () => {
  it('builds every archetype from the entire spell DB within budget', () => {
    const pool = [...spellDb.keys()]
    expect(pool.length).toBeGreaterThan(300) // the bundled DB is ~422 spells
    const start = performance.now()
    const r = generate(req({ pool }))
    const ms = performance.now() - start
    // the per-archetype budget gives EVERY archetype a share, not just the first
    for (const a of ARCHETYPES) expect(r[a].builds.length).toBeGreaterThan(0)
    // trim + budget keep it interactive (runs off the UI thread in a worker)
    expect(ms).toBeLessThan(5000)
  })
})

describe('generate — constraints + perk advice', () => {
  it('mustDig keeps only builds that dig', () => {
    for (const b of allBuilds(generate(req({ constraints: { mustDig: true } })))) {
      expect(deckHasDig(b.wand)).toBe(true)
    }
  })

  it('mustDig notes a pool with no digger', () => {
    const r = generate(req({ pool: ['LIGHT_BULLET', 'DAMAGE'], constraints: { mustDig: true } }))
    expect(r.DAMAGE.builds).toEqual([])
    expect(r.DAMAGE.note).toMatch(/dig/i)
  })

  it('flags an unsafe build, advises a fixing perk, and noSelfDamage removes it', () => {
    const pool = ['EXPLOSION'] // is_dangerous_blast → self-lethal with no perks
    const unsafe = allBuilds(generate(req({ pool, perks: [] }))).filter(
      (b) => b.analysis.selfDanger.unsafe,
    )
    expect(unsafe.length).toBeGreaterThan(0)
    expect(unsafe[0].perkAdvice?.perks).toContain('PROTECTION_EXPLOSION')

    clearSimCache()
    const safe = generate(req({ pool, constraints: { noSelfDamage: true } }))
    for (const b of allBuilds(safe)) expect(b.analysis.selfDanger.unsafe).toBe(false)

    clearSimCache()
    const withPerk = generate(req({ pool, perks: [{ id: 'PROTECTION_EXPLOSION', stacks: 1 }] }))
    for (const b of allBuilds(withPerk)) expect(b.perkAdvice).toBeUndefined()
  })
})

describe('generate — respects owned-copy counts (M5 quantity fix, snapshot_05)', () => {
  // snapshot_05 mirrors the confirmed in-game bug: CHAINSAW x8, but ONE DIGGER —
  // and DIGGER is the cheapest projectile (type-0 mana-0), so pre-fix the spam/
  // multicast templates flooded the deck with DIGGER ("~15 DIGGER when I own 1").
  const ownedReq = (counts: Map<string, number>, chassis: Wand, withCaps: boolean): GenerateRequest => ({
    pool: [...counts.keys()],
    counts: withCaps ? [...counts] : undefined,
    chassis,
    perks: [],
    constraints: {},
  })

  it('models the bug: CHAINSAW x8 + DIGGER x1 owned', () => {
    const snap = loadSnap('snapshot_05.json')
    const counts = ownedCounts(snap.wands, snap.spell_inventory)
    expect(counts.get('CHAINSAW')).toBe(8) // 2 in the deck + 6 in the bag
    expect(counts.get('DIGGER')).toBe(1)
  })

  it('no generated deck uses any spell more times than the player owns', () => {
    const snap = loadSnap('snapshot_05.json')
    const counts = ownedCounts(snap.wands, snap.spell_inventory)
    const builds = allBuilds(generate(ownedReq(counts, snap.wands[0], true)))
    expect(builds.length).toBeGreaterThan(0) // generation isn't trivially empty
    for (const b of builds) {
      for (const [id, n] of deckTally(b.wand)) {
        const own = counts.get(id) ?? 0
        expect(n, `${b.archetype}/${b.template} used ${id} x${n} but own ${own}`).toBeLessThanOrEqual(own)
      }
    }
  })

  it('DIGGER (cheapest projectile, owned 1) appears at most once in every build', () => {
    const snap = loadSnap('snapshot_05.json')
    const counts = ownedCounts(snap.wands, snap.spell_inventory)
    for (const b of allBuilds(generate(ownedReq(counts, snap.wands[0], true)))) {
      expect(deckTally(b.wand).get('DIGGER') ?? 0).toBeLessThanOrEqual(1)
    }
  })

  it('CONTROL — without caps the same pool floods (proves the cap is load-bearing)', () => {
    // Omit counts ⇒ unlimited ⇒ the cheapest projectile fills the deck many times
    // over, reproducing the bug. Guards against a future refactor silently dropping
    // the counts thread (the worker-forward / generate-build steps) into a no-op.
    const snap = loadSnap('snapshot_05.json')
    const counts = ownedCounts(snap.wands, snap.spell_inventory)
    const builds = allBuilds(generate(ownedReq(counts, snap.wands[0], false)))
    const maxDigger = Math.max(0, ...builds.map((b) => deckTally(b.wand).get('DIGGER') ?? 0))
    expect(maxDigger).toBeGreaterThan(1)
  })
})
