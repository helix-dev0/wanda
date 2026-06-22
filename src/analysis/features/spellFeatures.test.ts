import { describe, it, expect } from 'vitest'
import type { Wand } from '../../schema/snapshot'
import { spellFeatures, entityFeatures, deckFeatureCounts } from './spellFeatures'

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

describe('spellFeatures', () => {
  it('tags curated diggers / mobility / defensive / homing', () => {
    expect(spellFeatures('DIGGER')).toContain('DIG')
    expect(spellFeatures('BLACK_HOLE')).toContain('DIG')
    expect(spellFeatures('TELEPORT_CAST')).toContain('MOBILITY')
    expect(spellFeatures('MAGIC_SHIELD')).toContain('DEFENSIVE')
    expect(spellFeatures('HOMING')).toContain('HOMING')
  })

  it('derives MULTICAST from the DRAW_MANY type, not a curated id', () => {
    expect(spellFeatures('BURST_3')).toContain('MULTICAST')
    expect(spellFeatures('SCATTER_2')).toContain('MULTICAST')
  })

  it('a plain attack spell carries NO features (type=UTILITY/PROJECTILE is noise)', () => {
    // LIGHT_BULLET is a basic projectile — it must not be mistaken for utility.
    expect(spellFeatures('LIGHT_BULLET')).toEqual([])
    expect(spellFeatures('BUBBLESHOT')).toEqual([])
  })

  it('unknown / modded id resolves to [] without throwing', () => {
    expect(spellFeatures('ZZZ_MODDED_SPELL')).toEqual([])
  })

  it('entity fallback tags a drilling projectile as DIG', () => {
    expect(entityFeatures('data/entities/projectiles/deck/digger.xml')).toContain('DIG')
    expect(entityFeatures('data/entities/projectiles/deck/rubber_ball.xml')).toEqual([])
  })
})

describe('deckFeatureCounts', () => {
  it('counts features across the deck + always-cast, ignoring empty slots', () => {
    const wand = makeWand({
      spells: ['TELEPORT_CAST', 'DIGGER', null, 'BUBBLESHOT'],
      always_cast: ['HOMING'],
    })
    const c = deckFeatureCounts(wand)
    expect(c.MOBILITY).toBe(1)
    expect(c.DIG).toBe(1)
    expect(c.HOMING).toBe(1)
    expect(c.DEFENSIVE).toBe(0)
    expect(c.MULTICAST).toBe(0)
  })

  it('an empty deck → all-zero counts', () => {
    const c = deckFeatureCounts(makeWand({ spells: [null, null] }))
    expect(Object.values(c).every((n) => n === 0)).toBe(true)
  })
})
