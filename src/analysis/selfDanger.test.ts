import { describe, it, expect, beforeEach } from 'vitest'
import type { Wand, PerkRef } from '../schema/snapshot'
import type { WandShot, Projectile } from '../engine/eval/types'
import type { GunActionState } from '../engine/extra/types'
import { evalWand, clearSimCache } from './simCache'
import { evaluateSelfDanger } from './selfDanger'

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

const perk = (id: string): PerkRef => ({ id, stacks: 1 })

// Evaluate a real wand through the simulator (the production path).
const evalReal = (wand: Wand, perks: readonly PerkRef[] = []) =>
  evaluateSelfDanger(wand, evalWand(wand).sim.shots, perks)

// Synthetic shot for precise geometry/recoil logic, independent of the simulator.
const proj = (entity: string, id?: string): Projectile => ({
  entity,
  action: id ? ({ id } as unknown as Projectile['action']) : undefined,
})
const shot = (projectiles: Projectile[], cs?: Partial<GunActionState>): WandShot => ({
  projectiles,
  calledActions: [],
  actionTree: [],
  castState: cs ? (cs as GunActionState) : undefined,
})

describe('evaluateSelfDanger — FIRE (the acceptance criterion)', () => {
  beforeEach(() => clearSimCache())

  it('a flamethrower build is DANGEROUS without Fire Immunity', () => {
    const r = evalReal(makeWand({ spells: ['FLAMETHROWER'] }))
    const fire = r.findings.find((f) => f.hazard === 'FIRE')
    expect(fire?.severity).toBe('danger')
    expect(r.unsafe).toBe(true)
    expect(r.fixableByPerk).toContain('PROTECTION_FIRE')
  })

  it('the SAME build is SAFE with PROTECTION_FIRE', () => {
    const r = evalReal(makeWand({ spells: ['FLAMETHROWER'] }), [perk('PROTECTION_FIRE')])
    expect(r.findings.some((f) => f.hazard === 'FIRE')).toBe(false)
    expect(r.unsafe).toBe(false)
    expect(r.fixableByPerk).toEqual([])
  })

  it('Projectile Repulsion also neutralizes it (your flames never reach you)', () => {
    const r = evalReal(makeWand({ spells: ['FLAMETHROWER'] }), [perk('PROJECTILE_REPULSION')])
    expect(r.unsafe).toBe(false)
  })

  it('a ranged fire projectile (grenade) is a WARN, not unsafe — no crying wolf', () => {
    const r = evalReal(makeWand({ spells: ['GRENADE'] }))
    const fire = r.findings.find((f) => f.hazard === 'FIRE')
    expect(fire?.severity).toBe('warn')
    expect(r.unsafe).toBe(false)
  })
})

describe('evaluateSelfDanger — EXPLOSION in-face', () => {
  beforeEach(() => clearSimCache())

  it('a stationary big-blast (bomb at your feet) flags via geometry: radius ≥ reach', () => {
    // bomb.xml: speedMax 0 (reach 0), explosionRadius 60, explosionDamage 5.
    const r = evaluateSelfDanger(makeWand(), [shot([proj('data/entities/projectiles/bomb.xml')])], [])
    const ex = r.findings.find((f) => f.hazard === 'EXPLOSION')
    expect(ex?.severity).toBe('danger')
    expect(r.unsafe).toBe(true)
    expect(r.fixableByPerk).toContain('PROTECTION_EXPLOSION')
  })

  it('is_dangerous_blast (FIRE_BLAST) flags unconditionally and is fixed by immunity', () => {
    const r = evalReal(makeWand({ spells: ['FIRE_BLAST'] }))
    expect(r.unsafe).toBe(true)
    const safe = evalReal(makeWand({ spells: ['FIRE_BLAST'] }), [perk('PROTECTION_EXPLOSION')])
    expect(safe.findings.some((f) => f.hazard === 'EXPLOSION')).toBe(false)
  })

  it('a far-flying explosive (rubber_ball, reach ≫ radius) does NOT flag', () => {
    const r = evalReal(makeWand({ spells: ['RUBBER_BALL'] }))
    expect(r.findings.some((f) => f.hazard === 'EXPLOSION')).toBe(false)
    expect(r.unsafe).toBe(false)
  })

  it('a harmless DIGGING explosion (digger, explosionDamage 0) is NOT a hazard', () => {
    const r = evalReal(makeWand({ spells: ['DIGGER'] }))
    expect(r.findings).toEqual([])
    expect(r.unsafe).toBe(false)
  })

  it('a big-blast lobbed explosive (DYNAMITE) flags as danger even though it flies far', () => {
    // tnt.xml: explosionDamage 2.5 (62.5 HP), radius 28, speed 800, lifetime 50 → reachOf
    // ≈ 667px, so the old radius≥reach geometry MISSED it. But a 28px blast still engulfs
    // you in a cave. This is the case the maintainer caught — generation spammed Dynamite
    // onto a wand and never flagged it.
    const r = evalReal(makeWand({ spells: ['DYNAMITE'] }))
    const ex = r.findings.find((f) => f.hazard === 'EXPLOSION')
    expect(ex?.severity).toBe('danger')
    expect(r.unsafe).toBe(true)
    expect(r.fixableByPerk).toContain('PROTECTION_EXPLOSION')
  })

  it('a bouncing beam with a tiny blast (LASER) is NOT false-flagged', () => {
    // laser.xml bounces 10× but its blast is only 5.5 HP / 3px — harmless to you. The
    // large-blast rule must NOT catch it, or it would wreck the good fast-laser wand.
    const r = evalReal(makeWand({ spells: ['LASER'] }))
    expect(r.findings.some((f) => f.hazard === 'EXPLOSION')).toBe(false)
    expect(r.unsafe).toBe(false)
  })
})

describe('evaluateSelfDanger — TOXIC + RECOIL (warn-only, never unsafe)', () => {
  beforeEach(() => clearSimCache())

  it('an acid spell is a TOXIC warn, fixable by Radioactivity Immunity', () => {
    const r = evalReal(makeWand({ spells: ['ACIDSHOT'] }))
    const tox = r.findings.find((f) => f.hazard === 'TOXIC')
    expect(tox?.severity).toBe('warn')
    expect(r.unsafe).toBe(false)
    expect(r.fixableByPerk).toContain('PROTECTION_RADIOACTIVITY')
  })

  it('TOXIC is neutralized by PROTECTION_RADIOACTIVITY', () => {
    const r = evalReal(makeWand({ spells: ['ACIDSHOT'] }), [perk('PROTECTION_RADIOACTIVITY')])
    expect(r.findings.some((f) => f.hazard === 'TOXIC')).toBe(false)
  })

  it('high recoil is a warn (synthetic castState), and never sets unsafe', () => {
    const r = evaluateSelfDanger(makeWand(), [shot([proj('x.xml')], { recoil: 100 })], [])
    const rec = r.findings.find((f) => f.hazard === 'RECOIL')
    expect(rec?.severity).toBe('warn')
    expect(r.unsafe).toBe(false)
  })
})

describe('evaluateSelfDanger — safe baseline', () => {
  beforeEach(() => clearSimCache())

  it('a plain spammy wand (rubber_ball fixture) has no findings', () => {
    const r = evalReal(makeWand({ spells: ['RUBBER_BALL', 'RUBBER_BALL'] }))
    expect(r.findings).toEqual([])
    expect(r.unsafe).toBe(false)
  })
})
