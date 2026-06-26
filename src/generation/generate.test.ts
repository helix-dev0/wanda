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
  chassis: [chassis()],
  perks: [],
  constraints: {},
  ...over,
})

const allBuilds = (r: ReturnType<typeof generate>) => Object.values(r).flatMap((a) => a.builds)
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

  it('modifiers in the pool lift the top DAMAGE build (modifier-broadcast found by the survey)', () => {
    // The multiplier engine: damage modifiers BEFORE a multicast broadcast to every spell it
    // draws. The exhaustive search finds that arrangement on its own, so the modifiers'
    // presence lifts the top DAMAGE score AND the winning deck actually USES a modifier.
    const withMods = generate(req({ pool: ['BURST_3', 'DAMAGE', 'CRITICAL_HIT', 'LIGHT_BULLET'], archetypes: ['DAMAGE'] }))
    clearSimCache()
    const withoutMods = generate(req({ pool: ['BURST_3', 'LIGHT_BULLET'], archetypes: ['DAMAGE'] }))
    const top = (r: ReturnType<typeof generate>) => r.DAMAGE.builds[0]?.analysis.scores.DAMAGE.score ?? 0
    expect(top(withMods)).toBeGreaterThan(top(withoutMods) + 10) // a real lift, not noise
    const topDeck = withMods.DAMAGE.builds[0].wand.spells.filter(Boolean)
    expect(topDeck.some((s) => s === 'DAMAGE' || s === 'CRITICAL_HIT')).toBe(true)
  })

  it('a modifier pairs with the cheap shot for SPAM (modifier not wasted, no multicast needed)', () => {
    // No multicast in the pool — the search still pairs the damage modifier with the cheap
    // shot somewhere in the surveyed builds (the [modifier, shot] value unit).
    const r = generate(req({ pool: ['DAMAGE', 'LIGHT_BULLET'], archetypes: ['SPAM'] }))
    expect(r.SPAM.builds.length).toBeGreaterThan(0)
    const usesModifier = r.SPAM.builds.some(
      (b) => b.wand.spells.includes('DAMAGE') && b.wand.spells.includes('LIGHT_BULLET'),
    )
    expect(usesModifier).toBe(true)
  })

  it('explains an archetype it cannot build (no digging spells in pool)', () => {
    const r = generate(req({ pool: ['LIGHT_BULLET', 'DAMAGE'], archetypes: ['DIGGING'] }))
    expect(r.DIGGING.builds).toEqual([])
    expect(r.DIGGING.note).toMatch(/dig/i)
  })
})

describe('generate — exhaustive survey covers every chassis', () => {
  it('surveys both shuffle and non-shuffle chassis (judges order by score, no heuristic gating)', () => {
    // The exhaustive search scores each combination via the sim (which models the shuffle),
    // so order-dependent shapes are judged on their real score rather than excluded a priori.
    // Both chassis yield builds; the old template shuffle-gate no longer applies to the survey.
    const nonShuffle = generate(req())
    clearSimCache()
    const shuffle = generate(req({ chassis: [chassis({ shuffle: true })] }))
    expect(nonShuffle.DAMAGE.builds.length).toBeGreaterThan(0)
    expect(shuffle.DAMAGE.builds.length).toBeGreaterThan(0)
    // every surveyed build is labeled 'exhaustive' (the survey, not a fixed template)
    expect(allBuilds(nonShuffle).every((b) => b.template === 'exhaustive')).toBe(true)
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
    chassis: [chassis],
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

describe('generate — multi-chassis owned (build on ALL your wands, not just the held one)', () => {
  const held = chassis({ capacity: 4 }) // slot 0 (the held wand)
  const bigger = { ...chassis({ capacity: 12 }), slot: 2 } // a roomier NON-held wand

  it('builds on a non-held owned wand, attributing each build to its source chassis', () => {
    const builds = allBuilds(generate(req({ chassis: [held, bigger] })))
    expect(builds.length).toBeGreaterThan(0)
    // the core fix: the bigger NON-held wand is used as a base (pre-change: impossible)
    expect(builds.some((b) => b.chassis.slot === 2 && b.chassis.capacity === 12)).toBe(true)
    // the held wand is still a candidate base too
    expect(builds.some((b) => b.chassis.slot === 0 && b.chassis.capacity === 4)).toBe(true)
    // owned builds are never flagged as the theorycraft ideal chassis
    for (const b of builds) expect(b.chassis.ideal).toBe(false)
  })

  it('flags ideal=true only for a theorycraft request', () => {
    const theory = allBuilds(generate(req({ chassis: [held], theorycraft: true })))
    expect(theory.length).toBeGreaterThan(0)
    for (const b of theory) expect(b.chassis.ideal).toBe(true)
  })

  it('a roomier chassis builds a STRONGER wand from the same spells (the complaint fix)', () => {
    // Where capacity matters — a multicast scales with slots (more shots drawn per
    // cast) — the held cap-4 wand can barely multicast, while the roomy cap-12 wand
    // turns the SAME spells into a far stronger DAMAGE build. (A single-nuke pool
    // saturates on any chassis, so it's the wrong lens; capacity wins on throughput.)
    const r = generate(req({ chassis: [held, bigger], pool: ['LIGHT_BULLET', 'BURST_3', 'DAMAGE'] }))
    const dmg = r.DAMAGE.builds
    expect(dmg.length).toBeGreaterThan(0)
    const scoresFor = (cap: number) =>
      dmg.filter((b) => b.chassis.capacity === cap).map((b) => b.analysis.scores.DAMAGE.score)
    expect(Math.max(0, ...scoresFor(12))).toBeGreaterThan(Math.max(0, ...scoresFor(4)))
    expect(dmg[0].chassis.capacity).toBe(12) // the top DAMAGE build sits on the roomy wand
  })

  it('keeps the GLOBAL top-N per archetype (not N per chassis) across 4 chassis', () => {
    const four = [
      held,
      bigger,
      { ...chassis({ capacity: 6 }), slot: 1 },
      { ...chassis({ capacity: 8 }), slot: 3 },
    ]
    for (const a of Object.values(generate(req({ chassis: four })))) {
      expect(a.builds.length).toBeLessThanOrEqual(BUILDS_PER_ARCHETYPE)
    }
  })

  it('is deterministic with multiple chassis', () => {
    const a = generate(req({ chassis: [held, bigger] }))
    clearSimCache()
    const b = generate(req({ chassis: [held, bigger] }))
    expect(b).toEqual(a)
  })

  it('single chassis (N=1) collapses to the full budget — byte-identity guard', () => {
    // N=1 ⇒ subCap = ceil(MAX_CANDIDATES/1) = MAX_CANDIDATES, so the per-chassis budget
    // window equals the old per-archetype budget and single-chassis behavior is unchanged.
    // Pin it on the FULL DB (the most budget-stressing pool) so a future sub-budget
    // refactor that breaks the N=1 path fails HERE.
    const pool = [...spellDb.keys()]
    const a = generate(req({ chassis: [chassis()], pool }))
    clearSimCache()
    const b = generate(req({ chassis: [chassis()], pool }))
    expect(b).toEqual(a) // deterministic
    for (const arch of ARCHETYPES) expect(a[arch].builds.length).toBeGreaterThan(0) // full budget still builds all
  })

  it('gives every chassis a fair budget share — the 2nd chassis is not starved under a large pool', () => {
    const pool = [...spellDb.keys()]
    const builds = allBuilds(generate(req({ chassis: [held, bigger], pool })))
    expect(builds.some((b) => b.chassis.slot === 2)).toBe(true) // the 2nd chassis still got built on
  })

  it('respects owned-copy caps across ALL chassis (a roomier wand cannot over-use a spell)', () => {
    const snap = loadSnap('snapshot_05.json')
    const counts = ownedCounts(snap.wands, snap.spell_inventory)
    // a much roomier 2nd chassis alongside the real held wand — caps must still hold
    const roomy: Wand = { ...snap.wands[0], slot: 3, stats: { ...snap.wands[0].stats, capacity: 20 } }
    const builds = allBuilds(
      generate({
        pool: [...counts.keys()],
        counts: [...counts],
        chassis: [snap.wands[0], roomy],
        perks: [],
        constraints: {},
      }),
    )
    expect(builds.length).toBeGreaterThan(0)
    for (const b of builds) {
      for (const [id, n] of deckTally(b.wand)) {
        const own = counts.get(id) ?? 0
        expect(n, `${b.archetype}/${b.template} used ${id} x${n} but own ${own}`).toBeLessThanOrEqual(own)
      }
    }
  })
})
