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

/** A WandMetrics with neutral defaults; override only what a test exercises. Lets the
 *  calibration + mana-gate tests probe scoring at a controlled DPS / mana-sustain —
 *  robust to REF calibration, unlike the near-zero fixtures. */
const synthMetrics = (over: Partial<WandMetrics> = {}): WandMetrics => ({
  shotsUntilReload: 1, cycleFrames: 30, cycleSeconds: 0.5, fireSeconds: 0.3,
  projectilesPerCast: 1, projectilesPerCycle: 1, projectilesPerSecond: 6,
  damagePerCast: 0, damagePerCycle: 0, sustainedDps: 0, burstDps: 0,
  manaPerCycle: 0, manaSustainable: true, secondsUntilStall: null,
  effectiveSpread: 0, maxExplosionRadius: 0, maxExplosionDamage: 0,
  truncated: false, damageApproximate: false,
  ...over,
})
const scoreSynth = (over: Partial<WandMetrics>) =>
  scoreWand(makeWand(), { metrics: synthMetrics(over) } as unknown as WandEval)

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

describe('scoreWand — DAMAGE bands track the Noita power curve (calibration)', () => {
  // The saturation reference (REF.sustainedDps) is a PRODUCT calibration: S is reserved
  // for ELITE DPS (blended-DAMAGE crosses 80 at ~450 sustained), so a ~300-DPS wand is A,
  // not S, and
  // the top end stays discriminable — a 300-DPS wand and a 2000-DPS wand are NOT both S.
  // Magnitudes are provisional (no labeled real-wand corpus yet); the monotonic ORDERING
  // is the hard invariant, the bands an explicit intent pinned here so a future re-tune is
  // a deliberate, reviewed change rather than silent drift.
  const dmg = (sustainedDps: number) =>
    scoreSynth({ sustainedDps, burstDps: sustainedDps * 1.6 }).DAMAGE

  it('S is elite: 100 → C, 300 → A (not S), 700 → S', () => {
    expect(dmg(100).tier).toBe('C')
    expect(dmg(300).tier).toBe('A')
    expect(dmg(700).tier).toBe('S')
  })

  it('top end stays discriminable — a 300-DPS and a 2000-DPS wand are not both S', () => {
    expect(dmg(2000).score).toBeGreaterThan(dmg(300).score)
    expect(dmg(300).tier).not.toBe('S')
    expect(dmg(2000).tier).toBe('S')
  })
})

describe('scoreWand — fixture orderings (signature-dominant)', () => {
  beforeEach(() => clearSimCache())

  it('DAMAGE ranks the grenade (hardest hit) above the spam wands', () => {
    const g = scoreOf(heldWand('snapshot_02.json')).DAMAGE.score // GRENADE
    const b = scoreOf(heldWand('snapshot_03.json')).DAMAGE.score // BUBBLESHOT
    const r = scoreOf(heldWand('snapshot_01.json')).DAMAGE.score // RUBBER_BALL
    expect(g).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(r)
  })

  it('SPAM mana-gate: at equal DPS+rate the sustainable wand strictly beats the staller', () => {
    // The calibration-robust property. (The old `bubble.score > grenade.score` fixture
    // ordering was a low-REF artifact: both fixtures are near-zero DPS, so once REF rose
    // the 117-DPS gated grenade edged the 17-DPS sustainable bubble — a meaningless
    // ordering between two terrible spammers.) Isolate the gate: identical sustained
    // DPS + fire rate, differ ONLY on mana sustain; the gate must drop the staller.
    const sustainable = scoreSynth({ sustainedDps: 200, burstDps: 320, manaSustainable: true }).SPAM
    const stalling = scoreSynth({ sustainedDps: 200, burstDps: 320, manaSustainable: false, secondsUntilStall: 3 }).SPAM
    expect(sustainable.score).toBeGreaterThan(stalling.score)
    expect(stalling.reasons.join(' ')).toMatch(/mana/i)
  })

  it('SPAM surfaces the real-fixture mana state (grenade gated, bubble sustainable)', () => {
    const bubble = scoreOf(heldWand('snapshot_03.json')).SPAM
    const grenade = scoreOf(heldWand('snapshot_02.json')).SPAM
    expect(grenade.reasons.join(' ')).toMatch(/mana/i)
    expect(bubble.topMetrics.find((t) => t.label === 'Mana')?.value).toBe('sustainable')
  })

  it('held fixtures have no mobility/defensive content', () => {
    for (const s of ['snapshot_01.json', 'snapshot_02.json', 'snapshot_03.json']) {
      const sc = scoreOf(heldWand(s))
      expect(sc.MOBILITY.score).toBe(0)
      expect(sc.DEFENSIVE.score).toBe(0)
    }
  })
})

describe('scoreWand — SPAM rewards effective damage, not raw projectile count (Tier 0)', () => {
  beforeEach(() => clearSimCache())

  // The exact stats of the maintainer's real held wand (cap-5, sustainable).
  const RUN_STATS = {
    shuffle: false,
    spellsPerCast: 1,
    castDelay: 7,
    rechargeTime: 21,
    manaMax: 83,
    mana: 83,
    manaChargeSpeed: 255,
    capacity: 5,
    spread: 1,
    speedMultiplier: 1.13,
  }

  it('the real held wand out-spams the chainsaw build that wrongly beat it', () => {
    // THE reported bug: on the old formula (projectiles/sec only) the chainsaw deck
    // (more, weaker shots) scored SPAM 99 vs the held wand's 93 despite ~⅓ the DPS.
    const held = makeWand({
      spells: ['MANA_REDUCE', 'BURST_3', 'DAMAGE', 'BUCKSHOT', 'CHAINSAW'],
      stats: RUN_STATS,
    })
    const chainsaw = makeWand({
      spells: ['BUCKSHOT', 'CHAINSAW', 'CHAINSAW', 'CHAINSAW', 'SPITTER'],
      stats: RUN_STATS,
    })
    expect(scoreOf(held).SPAM.score).toBeGreaterThan(scoreOf(chainsaw).SPAM.score)
  })

  it('adding a damage modifier raises SPAM (it now has a damage term)', () => {
    const sustainable = { manaMax: 2000, mana: 2000, manaChargeSpeed: 1000, capacity: 6 }
    const plain = makeWand({ spells: ['SPITTER', 'SPITTER'], stats: { ...makeWand().stats, ...sustainable } })
    const boosted = makeWand({ spells: ['DAMAGE', 'SPITTER', 'SPITTER'], stats: { ...makeWand().stats, ...sustainable } })
    // same shots, more damage each → a better spammer (was identical under proj/sec-only)
    expect(scoreOf(boosted).SPAM.score).toBeGreaterThan(scoreOf(plain).SPAM.score)
  })
})

describe('scoreWand — AoE responds to real blast size', () => {
  beforeEach(() => clearSimCache())

  it('a 60px bomb scores far higher AoE than a 7px grenade', () => {
    const bomb = makeWand({ spells: ['BOMB'] })
    expect(evalWand(bomb).metrics.maxExplosionRadius).toBeGreaterThan(30) // sanity: it simulates big
    const bombAoe = scoreOf(bomb).AOE
    const grenadeAoe = scoreOf(heldWand('snapshot_02.json')).AOE
    expect(bombAoe.score).toBeGreaterThan(grenadeAoe.score)
    expect(['S', 'A', 'B']).toContain(bombAoe.tier) // reaches a meaningful tier
  })
})

describe('scoreWand — feature archetypes (deck content)', () => {
  beforeEach(() => clearSimCache())

  it('digging + movement → top-tier Mobility', () => {
    const sc = scoreOf(makeWand({ spells: ['DIGGER', 'TELEPORT_CAST'] }))
    expect(sc.MOBILITY.score).toBe(100)
    expect(sc.MOBILITY.tier).toBe('S')
  })

  it('digging alone → A-tier Mobility', () => {
    const sc = scoreOf(makeWand({ spells: ['DIGGER'] }))
    expect(sc.MOBILITY.score).toBe(60)
    expect(sc.MOBILITY.tier).toBe('A')
  })

  it('a shield → A-tier Defensive; shield + homing → S', () => {
    expect(scoreOf(makeWand({ spells: ['MAGIC_SHIELD'] })).DEFENSIVE.tier).toBe('A')
    const both = scoreOf(makeWand({ spells: ['MAGIC_SHIELD', 'HOMING'] })).DEFENSIVE
    expect(both.score).toBe(100)
    expect(both.tier).toBe('S')
  })
})
