import { describe, it, expect, beforeEach } from 'vitest'
import { parseSnapshot, type Wand } from '../schema/snapshot'
import { evalWand, clearSimCache, type WandEval } from './simCache'
import { scoreWand, tierForScore } from './archetypes'
import type { WandMetrics } from '../sim/metrics'

const fixtures = import.meta.glob('../data/fixtures/snapshot_*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const heldWand = (suffix: string): Wand => {
  const key = Object.keys(fixtures).find((k) => k.endsWith('/' + suffix))
  if (!key) throw new Error(`fixture not found: ${suffix}`)
  return parseSnapshot(fixtures[key]).wands[0]
}

const makeWand = (over: Partial<Wand> = {}): Wand => ({
  slot: 0,
  always_cast: [],
  spells: [],
  stats: {
    shuffle: false,
    spellsPerCast: 1,
    castDelay: 10,
    rechargeTime: 20,
    manaMax: 500,
    mana: 500,
    manaChargeSpeed: 100,
    capacity: 6,
    spread: 0,
    speedMultiplier: 1,
  },
  ...over,
})

const scoreOf = (wand: Wand) => scoreWand(wand, evalWand(wand))

/** A WandMetrics with neutral defaults; override only what a test exercises. */
const synthMetrics = (over: Partial<WandMetrics> = {}): WandMetrics => {
  const base: WandMetrics = {
    shotsUntilReload: 1, cycleFrames: 30, cycleSeconds: 0.5, fireSeconds: 0.3,
    projectilesPerCast: 1, projectilesPerCycle: 1, projectilesPerSecond: 6,
    damagePerCast: 0, damagePerCycle: 0, sustainedDps: 0, effectiveSustainedDps: 0, burstDps: 0,
    firstCastSeconds: 0.5, pierceReachPx: 0, pierceHitHP: 0,
    manaPerCycle: 0, manaSustainable: true, secondsUntilStall: null,
    effectiveSpread: 0, reachUsability: 1, maxExplosionRadius: 0, maxExplosionDamage: 0,
    appliesDot: { fire: false, poison: false, toxic: false }, hasTrigger: false, homing: false,
    truncated: false, damageApproximate: false,
  }
  const merged = { ...base, ...over }
  if (over.effectiveSustainedDps === undefined) merged.effectiveSustainedDps = merged.sustainedDps
  return merged
}
const scoreSynth = (over: Partial<WandMetrics>) =>
  scoreWand(makeWand(), { metrics: synthMetrics(over) } as unknown as WandEval)

/** Coherent damage metrics for the TTK scorer: a wand doing `sustainedDps` with one shot per
 *  cycle, so damagePerCast/Cycle + firstCastSeconds line up with the rate (the new model reads
 *  damagePerCast for the one-shot floor, not just sustainedDps). */
const dmgScore = (sustainedDps: number, over: Partial<WandMetrics> = {}) => {
  const cycleSeconds = over.cycleSeconds ?? 0.5
  const damagePerCast = over.damagePerCast ?? sustainedDps * cycleSeconds
  return scoreSynth({
    sustainedDps, cycleSeconds, damagePerCast, damagePerCycle: damagePerCast, firstCastSeconds: cycleSeconds, ...over,
  })
}

describe('tierForScore — absolute band boundaries', () => {
  it('maps scores to S/A/B/C/D at 80/60/40/20', () => {
    expect(tierForScore(80)).toBe('S')
    expect(tierForScore(79)).toBe('A')
    expect(tierForScore(60)).toBe('A')
    expect(tierForScore(40)).toBe('B')
    expect(tierForScore(20)).toBe('C')
    expect(tierForScore(19)).toBe('D')
    expect(tierForScore(0)).toBe('D')
  })
})

describe('scoreWand — DAMAGE/SPAM scale by range usability (close-range ≠ ranged DPS)', () => {
  // reachUsability ∈ [0,1] is the fraction of damage that reaches a ranged target. The TTK
  // scorer folds it into the focus factor, so a close-range tool kills slower → scores lower.
  it('penalizes a close-range deck vs a fully-ranged deck at equal DPS', () => {
    const ranged = dmgScore(300, { reachUsability: 1 })
    const close = dmgScore(300, { reachUsability: 0.19 }) // luminous drill ~47px
    expect(close.DAMAGE.score).toBeLessThan(ranged.DAMAGE.score - 15)
    expect(close.SPAM.score).toBeLessThan(ranged.SPAM.score - 10)
  })
  it('scales the score monotonically with usability (full > partial > floor)', () => {
    const score = (u: number) => dmgScore(300, { reachUsability: u }).DAMAGE.score
    expect(score(1)).toBeGreaterThan(score(0.5))
    expect(score(0.5)).toBeGreaterThan(score(0.1))
  })
  it('a 0-damage deck stays 0 DAMAGE regardless of usability (no spurious change)', () => {
    expect(dmgScore(0, { reachUsability: 1 }).DAMAGE.score).toBe(0)
  })
})

describe('scoreWand — DAMAGE TTK bands track the Noita power curve (calibration)', () => {
  // The bands come from TTK vs the cited reference enemies (Isohiisi 150 + Ylialkemisti 1000),
  // not an abstract REF. Magnitudes are PROVISIONAL (meta-expert tunes at S6); the monotonic
  // ORDERING + the boss-anchor discrimination (300 ≠ S, 2000 = S) are the hard invariants.
  const dmg = (sustainedDps: number) => dmgScore(sustainedDps).DAMAGE

  it('higher sustained DPS ⇒ strictly higher DAMAGE (monotonic across the curve)', () => {
    expect(dmg(100).score).toBeLessThan(dmg(300).score)
    expect(dmg(300).score).toBeLessThan(dmg(700).score)
    expect(dmg(700).score).toBeLessThanOrEqual(dmg(2000).score)
  })

  it('the boss anchor discriminates the top — a 300-DPS wand is not S, a 2000-DPS one is', () => {
    expect(dmg(2000).score).toBeGreaterThan(dmg(300).score)
    expect(dmg(300).tier).not.toBe('S')
    expect(dmg(2000).tier).toBe('S')
  })

  it('DAMAGE penalizes wide spread — a tight BURST beats a wide SCATTER at equal raw DPS', () => {
    const tight = dmgScore(300, { effectiveSpread: 0 }).DAMAGE
    const wide = dmgScore(300, { effectiveSpread: 18 }).DAMAGE
    expect(tight.score).toBeGreaterThan(wide.score)
    expect(wide.reasons.join(' ')).toMatch(/spread/i)
    // A FOCUSED wand (spread ≤ 0) pays no penalty.
    expect(dmgScore(300, { effectiveSpread: -3 }).DAMAGE.score).toBe(
      dmgScore(300, { effectiveSpread: 0 }).DAMAGE.score,
    )
  })
})

describe('scoreWand — homing rescues spread (single-target accuracy)', () => {
  // Grounded: homing "imparts constant force… towards your foes" within ~150px
  // (noita.wiki.gg/wiki/Homing), so a wide scatter still connects — but it trades precision
  // for control ("accuracy can suffer"), so it lands ≈ a tight wand, not a perfect one.
  it('detects homing from the REAL cast tree (incl. an always-cast HOMING_CURSOR)', () => {
    clearSimCache()
    expect(evalWand(makeWand({ spells: ['HOMING', 'SCATTER_4', 'BULLET'] })).metrics.homing).toBe(true)
    expect(evalWand(makeWand({ spells: ['SCATTER_4', 'BULLET'] })).metrics.homing).toBe(false)
    expect(evalWand(makeWand({ spells: ['BULLET'], always_cast: ['HOMING_CURSOR'] })).metrics.homing).toBe(true)
  })

  it('a wide spray with homing scores FAR above the bare spray, and ≈ a tight wand', () => {
    const wide = dmgScore(300, { effectiveSpread: 42 }).DAMAGE.score
    const homingWide = dmgScore(300, { effectiveSpread: 42, homing: true }).DAMAGE.score
    const tight = dmgScore(300, { effectiveSpread: 0 }).DAMAGE.score
    expect(homingWide).toBeGreaterThan(wide + 10) // the rescue: spray no longer sprays off
    expect(homingWide).toBeLessThanOrEqual(tight) // but never beats a perfectly-focused wand
    expect(homingWide).toBeGreaterThan(tight * 0.8) // lands close to tight (floor 0.9 vs 1.0)
  })

  it('homing does NOT reduce an already-tight wand (max(floor, raw))', () => {
    expect(dmgScore(300, { effectiveSpread: 0, homing: true }).DAMAGE.score).toBe(
      dmgScore(300, { effectiveSpread: 0 }).DAMAGE.score,
    )
  })

  it('surfaces a homing reason and suppresses the "sprays off target" warning', () => {
    const r = dmgScore(300, { effectiveSpread: 42, homing: true }).DAMAGE.reasons.join(' ')
    expect(r).toMatch(/homing/i)
    expect(r).not.toMatch(/sprays off/i)
  })

  it('DoT now IMPROVES boss DAMAGE (it softens a high-HP target) and surfaces a note', () => {
    // The v2 inversion: DoT is a real damage stream (2%/s of max HP, capped at the floor), so
    // it lowers the boss TTK rather than being a score-neutral note. It shines vs tanky targets.
    const plain = dmgScore(120).DAMAGE
    const withDot = dmgScore(120, { appliesDot: { fire: true, poison: true, toxic: false } }).DAMAGE
    expect(withDot.score).toBeGreaterThan(plain.score)
    expect(withDot.reasons.join(' ')).toMatch(/fire\+poison/)
    expect(withDot.reasons.join(' ')).toMatch(/boss/i)
    expect(plain.reasons.join(' ')).not.toMatch(/DoT/)
  })
})

describe('scoreWand — fixture orderings (signature-dominant)', () => {
  beforeEach(() => clearSimCache())

  it('DAMAGE ranks the grenade (hardest hit) above the spam wands', () => {
    const g = scoreOf(heldWand('snapshot_02.json')).DAMAGE.score // GRENADE
    const b = scoreOf(heldWand('snapshot_03.json')).DAMAGE.score // BUBBLESHOT
    const r = scoreOf(heldWand('snapshot_01.json')).DAMAGE.score // RUBBER_BALL
    expect(g).toBeGreaterThanOrEqual(b)
    expect(b).toBeGreaterThanOrEqual(r)
    expect(g).toBeGreaterThan(r)
  })

  it('SPAM mana-throttle: at equal RAW DPS the sustainable wand beats the mana-starved one', () => {
    const sustainable = scoreSynth({ sustainedDps: 200, effectiveSustainedDps: 200 }).SPAM
    const stalling = scoreSynth({ sustainedDps: 200, effectiveSustainedDps: 40, manaSustainable: false, secondsUntilStall: 3 }).SPAM
    expect(sustainable.score).toBeGreaterThan(stalling.score)
    expect(stalling.reasons.join(' ')).toMatch(/mana/i)
  })

  it('SPAM surfaces the real-fixture mana state (grenade gated, bubble sustainable)', () => {
    const bubble = scoreOf(heldWand('snapshot_03.json')).SPAM
    const grenade = scoreOf(heldWand('snapshot_02.json')).SPAM
    expect(grenade.reasons.join(' ')).toMatch(/mana/i)
    expect(bubble.topMetrics.find((t) => t.label === 'Mana')?.value).toBe('sustainable')
  })

  it('held fixtures have no digging content → DIGGING scores 0', () => {
    for (const s of ['snapshot_01.json', 'snapshot_02.json', 'snapshot_03.json']) {
      expect(scoreOf(heldWand(s)).DIGGING.score).toBe(0)
    }
  })
})

describe('scoreWand — SPAM rewards effective damage, not raw projectile count (Tier 0)', () => {
  beforeEach(() => clearSimCache())

  const RUN_STATS = {
    shuffle: false, spellsPerCast: 1, castDelay: 7, rechargeTime: 21,
    manaMax: 83, mana: 83, manaChargeSpeed: 255, capacity: 5, spread: 1, speedMultiplier: 1.13,
  }

  it('the real held wand out-spams the chainsaw build that wrongly beat it', () => {
    const held = makeWand({ spells: ['MANA_REDUCE', 'BURST_3', 'DAMAGE', 'BUCKSHOT', 'CHAINSAW'], stats: RUN_STATS })
    const chainsaw = makeWand({ spells: ['BUCKSHOT', 'CHAINSAW', 'CHAINSAW', 'CHAINSAW', 'SPITTER'], stats: RUN_STATS })
    expect(scoreOf(held).SPAM.score).toBeGreaterThan(scoreOf(chainsaw).SPAM.score)
  })

  it('adding a damage modifier raises SPAM (it now has a damage term)', () => {
    const sustainable = { manaMax: 2000, mana: 2000, manaChargeSpeed: 1000, capacity: 6 }
    const plain = makeWand({ spells: ['SPITTER', 'SPITTER'], stats: { ...makeWand().stats, ...sustainable } })
    const boosted = makeWand({ spells: ['DAMAGE', 'SPITTER', 'SPITTER'], stats: { ...makeWand().stats, ...sustainable } })
    expect(scoreOf(boosted).SPAM.score).toBeGreaterThan(scoreOf(plain).SPAM.score)
  })
})

describe('scoreWand — AoE responds to real blast size', () => {
  beforeEach(() => clearSimCache())

  it('a 60px bomb scores far higher AoE than a 7px grenade', () => {
    const bomb = makeWand({ spells: ['BOMB'] })
    expect(evalWand(bomb).metrics.maxExplosionRadius).toBeGreaterThan(30)
    const bombAoe = scoreOf(bomb).AOE
    const grenadeAoe = scoreOf(heldWand('snapshot_02.json')).AOE
    expect(bombAoe.score).toBeGreaterThan(grenadeAoe.score)
    expect(['S', 'A', 'B']).toContain(bombAoe.tier)
  })
})

describe('scoreWand — DIGGING (capability × sustainability)', () => {
  beforeEach(() => clearSimCache())

  it('a top-tier digger outranks a low-tier one, and a non-digger scores 0', () => {
    const luminous = scoreOf(makeWand({ spells: ['LUMINOUS_DRILL'] })).DIGGING
    const digger = scoreOf(makeWand({ spells: ['DIGGER'] })).DIGGING
    const none = scoreOf(makeWand({ spells: ['LIGHT_BULLET'] })).DIGGING
    expect(luminous.score).toBeGreaterThan(digger.score)
    expect(digger.score).toBeGreaterThan(none.score)
    expect(none.score).toBe(0)
  })

  it('a sustainable digger outranks an unsustainable higher-capability one (§7.5)', () => {
    // Luminous Drill (tier 14, 10 mana, sustains) vs Black Hole (tier 13, 180 mana, stalls).
    const luminous = scoreOf(makeWand({ spells: ['LUMINOUS_DRILL'] })).DIGGING
    const blackHole = scoreOf(makeWand({ spells: ['BLACK_HOLE'] })).DIGGING
    expect(luminous.score).toBeGreaterThan(blackHole.score)
  })

  it('a pure digger is demoted on combat (DAMAGE near zero, DIGGING high)', () => {
    const sc = scoreOf(makeWand({ spells: ['LUMINOUS_DRILL'] }))
    expect(sc.DAMAGE.score).toBeLessThan(20) // ~0 combat — a digging beam, not a damage wand
    expect(sc.DIGGING.score).toBeGreaterThan(sc.DAMAGE.score)
  })
})
