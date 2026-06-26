import { describe, it, expect } from 'vitest'
import type { Wand } from '../schema/snapshot'
import { wandKey, chassisKey } from './wandKey'

const makeWand = (over: Partial<Wand> = {}): Wand => ({
  slot: 0,
  always_cast: [],
  spells: ['BUBBLESHOT'],
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

describe('wandKey', () => {
  it('is stable across the volatile current mana (same chassis ⇒ same key)', () => {
    const full = makeWand({ stats: { ...makeWand().stats, mana: 500 } })
    const drained = makeWand({ stats: { ...makeWand().stats, mana: 12 } })
    expect(wandKey(drained)).toBe(wandKey(full))
  })

  it('ignores slot (a wand moves between slots)', () => {
    expect(wandKey(makeWand({ slot: 3 }))).toBe(wandKey(makeWand({ slot: 0 })))
  })

  it('varies with the deck loadout', () => {
    expect(wandKey(makeWand({ spells: ['GRENADE'] }))).not.toBe(
      wandKey(makeWand({ spells: ['BUBBLESHOT'] })),
    )
  })

  it('varies with always_cast', () => {
    expect(wandKey(makeWand({ always_cast: ['DAMAGE'] }))).not.toBe(wandKey(makeWand()))
  })

  it('varies with a non-mana stat change (e.g. spread)', () => {
    expect(wandKey(makeWand({ stats: { ...makeWand().stats, spread: 10 } }))).not.toBe(
      wandKey(makeWand()),
    )
  })

  it('is independent of stat key order (cross-platform serialization)', () => {
    const base = makeWand()
    // Rebuild stats with reversed insertion order — same values, different key order.
    const reordered: Wand = {
      ...base,
      stats: Object.fromEntries(Object.entries(base.stats).reverse()) as Wand['stats'],
    }
    expect(wandKey(reordered)).toBe(wandKey(base))
  })
})

describe('chassisKey (the regeneration key — deck-independent)', () => {
  it('is the SAME when ONLY the deck changes — rearranging owned spells must not re-rank suggestions', () => {
    expect(chassisKey(makeWand({ spells: ['GRENADE', 'DAMAGE', 'NUKE'] }))).toBe(
      chassisKey(makeWand({ spells: ['BUBBLESHOT'] })),
    )
  })

  it('varies with a real chassis change (capacity / stats / always-cast)', () => {
    expect(chassisKey(makeWand({ stats: { ...makeWand().stats, capacity: 8 } }))).not.toBe(chassisKey(makeWand()))
    expect(chassisKey(makeWand({ always_cast: ['RECHARGE'] }))).not.toBe(chassisKey(makeWand()))
  })

  it('is stable across the volatile current mana (firing must not re-fire generation)', () => {
    expect(chassisKey(makeWand({ stats: { ...makeWand().stats, mana: 12 } }))).toBe(chassisKey(makeWand()))
  })
})
