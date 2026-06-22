import { describe, it, expect, beforeEach } from 'vitest'
import { generate } from './generate'
import { clearSimCache } from '../analysis/simCache'
import { deckFeatureCounts } from '../analysis/features/spellFeatures'
import { BUILDS_PER_ARCHETYPE } from './budget'
import { spellDb } from '../data/spellDb'
import { ARCHETYPES } from '../analysis'
import type { Wand, WandStats } from '../schema/snapshot'
import type { GenerateRequest } from './types'

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
