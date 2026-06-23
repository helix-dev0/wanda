import { describe, it, expect } from 'vitest'
import { buildPoolIndex } from './poolIndex'
import { countCombinations, enumerateDecks } from './exhaustive'

const POOL = ['DAMAGE', 'BURST_3', 'ADD_TRIGGER', 'BOUNCY_ORB', 'CHAINSAW']
const ix = buildPoolIndex(POOL)
const caps = (m: Record<string, number>) => new Map(Object.entries(m))

describe('exhaustive enumeration', () => {
  it('countCombinations equals the number of decks enumerated (complete survey)', () => {
    const c = caps({ DAMAGE: 1, BURST_3: 1, ADD_TRIGGER: 1, BOUNCY_ORB: 5, CHAINSAW: 3 })
    for (const capacity of [3, 5, 6]) {
      const n = countCombinations(POOL, c, capacity)
      const decks = enumerateDecks(POOL, c, capacity, ix, Number.MAX_SAFE_INTEGER)
      expect(decks.length).toBe(n)
    }
  })

  it('never exceeds owned caps (a deck can not socket a card you do not have)', () => {
    const c = caps({ DAMAGE: 1, BURST_3: 1, ADD_TRIGGER: 1, BOUNCY_ORB: 2, CHAINSAW: 3 })
    for (const deck of enumerateDecks(POOL, c, 6, ix, Number.MAX_SAFE_INTEGER)) {
      const counts = new Map<string, number>()
      for (const id of deck) counts.set(id, (counts.get(id) ?? 0) + 1)
      for (const [id, n] of counts) expect(n).toBeLessThanOrEqual(c.get(id)!)
    }
  })

  it('never exceeds chassis capacity', () => {
    const c = caps({ BOUNCY_ORB: 99 })
    for (const deck of enumerateDecks(['BOUNCY_ORB'], c, 4, ix, Number.MAX_SAFE_INTEGER)) {
      expect(deck.length).toBeLessThanOrEqual(4)
    }
  })

  it('lays each combination in canonical order: modifier → multicast → trigger → shot', () => {
    const c = caps({ DAMAGE: 1, BURST_3: 1, ADD_TRIGGER: 1, BOUNCY_ORB: 1, CHAINSAW: 1 })
    const decks = enumerateDecks(POOL, c, 5, ix, Number.MAX_SAFE_INTEGER)
    // the full 5-card deck must be ordered DAMAGE(mod), BURST_3(multicast), ADD_TRIGGER(trigger), then shots
    const full = decks.find((d) => d.length === 5)!
    expect(full).toEqual(['DAMAGE', 'BURST_3', 'ADD_TRIGGER', 'BOUNCY_ORB', 'CHAINSAW'])
    // a modifier always precedes a multicast wherever both appear
    for (const d of decks) {
      const mi = d.indexOf('DAMAGE')
      const bi = d.indexOf('BURST_3')
      if (mi >= 0 && bi >= 0) expect(mi).toBeLessThan(bi)
    }
  })

  it('is deterministic (same inputs → identical output)', () => {
    const c = caps({ DAMAGE: 1, BURST_3: 1, BOUNCY_ORB: 3, CHAINSAW: 2 })
    const a = enumerateDecks(POOL, c, 5, ix, Number.MAX_SAFE_INTEGER)
    const b = enumerateDecks(POOL, c, 5, ix, Number.MAX_SAFE_INTEGER)
    expect(a).toEqual(b)
  })

  it('honors maxDecks as a runaway guard', () => {
    const c = caps({ BOUNCY_ORB: 99 })
    expect(enumerateDecks(['BOUNCY_ORB'], c, 20, ix, 5).length).toBe(5)
  })

  it('unbounded id (no cap) is limited by capacity, not infinite', () => {
    // CHAINSAW absent from caps ⇒ usable up to capacity
    expect(countCombinations(['CHAINSAW'], caps({}), 4)).toBe(4) // 1..4 copies
  })
})
