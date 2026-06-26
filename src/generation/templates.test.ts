import { describe, it, expect } from 'vitest'
import { TEMPLATES, type TemplateContext } from './templates'
import { buildPoolIndex } from './poolIndex'
import { ARCHETYPES, type Archetype } from '../analysis'

const tpl = (id: string) => {
  const t = TEMPLATES.find((x) => x.id === id)
  if (!t) throw new Error(`no template ${id}`)
  return t
}

const ctx = (
  pool: string[],
  over: Partial<Omit<TemplateContext, 'index'>> = {},
): TemplateContext => ({
  index: buildPoolIndex(pool),
  capacity: 6,
  shuffle: false,
  archetype: 'DAMAGE',
  ...over,
})

const caps = (pairs: [string, number][]) => new Map(pairs)
const count = (deck: string[], id: string) => deck.filter((x) => x === id).length

describe('templates — instantiate seed decks from the pool', () => {
  it('single-nuke stacks modifiers before the nuke', () => {
    const seeds = tpl('single-nuke').instantiate(ctx(['DAMAGE', 'NUKE']))
    expect(seeds).toEqual([['DAMAGE', 'NUKE']])
  })

  it('single-nuke yields nothing without a nuke', () => {
    expect(tpl('single-nuke').instantiate(ctx(['LIGHT_BULLET']))).toEqual([])
  })

  it('trigger-payload places the trigger first', () => {
    const seeds = tpl('trigger-payload').instantiate(ctx(['ADD_TRIGGER', 'LIGHT_BULLET', 'BOMB']))
    expect(seeds[0][0]).toBe('ADD_TRIGGER')
    expect(seeds[0].length).toBeGreaterThanOrEqual(2)
  })

  it('spammer fills capacity with the cheapest DAMAGE projectile', () => {
    // LIGHT_BULLET(5) < BOMB(25). (CHAINSAW would be cheaper but it's a DIG-tagged
    // utility enabler — diggers/teleports never seed a damage build, see isUtilitySpell.)
    expect(tpl('spammer').instantiate(ctx(['BOMB', 'LIGHT_BULLET'], { capacity: 3, archetype: 'SPAM' }))).toEqual([
      ['LIGHT_BULLET', 'LIGHT_BULLET', 'LIGHT_BULLET'],
    ])
  })

  it('spammer excludes utility (digging) projectiles even when cheapest', () => {
    // Pool of ONLY a digger + a real projectile: the digger (DIG) is never the spam
    // payload; the deck fills with the damage projectile.
    const seeds = tpl('spammer').instantiate(ctx(['DIGGER', 'BOMB'], { capacity: 2, archetype: 'SPAM' }))
    expect(seeds[0]?.every((id) => id === 'BOMB')).toBe(true)
  })

  it('multicast-stack leads with the multicast spell', () => {
    const seeds = tpl('multicast-stack').instantiate(
      ctx(['BURST_3', 'LIGHT_BULLET'], { capacity: 4, archetype: 'AOE' }),
    )
    expect(seeds[0][0]).toBe('BURST_3')
  })

  it('multiplicative-stack: modifiers, then the multicast, then shots (broadcast order)', () => {
    const seeds = tpl('multiplicative-stack').instantiate(
      ctx(['DAMAGE', 'CRITICAL_HIT', 'BURST_3', 'LIGHT_BULLET'], { capacity: 6, archetype: 'DAMAGE' }),
    )
    expect(seeds).toHaveLength(1)
    const deck = seeds[0]
    const mcIdx = deck.indexOf('BURST_3')
    expect(mcIdx).toBeGreaterThan(0) // ≥1 modifier precedes the multicast (so it broadcasts)
    expect(deck.slice(0, mcIdx).every((id) => id === 'DAMAGE' || id === 'CRITICAL_HIT')).toBe(true)
    expect(deck.slice(mcIdx + 1)).toContain('LIGHT_BULLET') // ≥1 shot for the multicast to draw
  })

  it('multiplicative-stack needs BOTH a multicast and a modifier', () => {
    expect(tpl('multiplicative-stack').instantiate(ctx(['DAMAGE', 'LIGHT_BULLET']))).toEqual([]) // no multicast
    expect(tpl('multiplicative-stack').instantiate(ctx(['BURST_3', 'LIGHT_BULLET']))).toEqual([]) // no modifier
  })

  it('cheap-shot-spam pairs a modifier immediately before a cheap shot', () => {
    const seeds = tpl('cheap-shot-spam').instantiate(
      ctx(['DAMAGE', 'LIGHT_BULLET'], { capacity: 4, archetype: 'SPAM' }),
    )
    expect(seeds).toHaveLength(1)
    const deck = seeds[0]
    const i = deck.indexOf('DAMAGE')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(deck[i + 1]).toBe('LIGHT_BULLET') // a [modifier, shot] pairing
  })

  it('cheap-shot-spam yields nothing without a modifier (else it is just spammer)', () => {
    expect(tpl('cheap-shot-spam').instantiate(ctx(['LIGHT_BULLET'], { archetype: 'SPAM' }))).toEqual([])
  })

  it('feature-fill (digging) includes the pool’s digging spells', () => {
    const seeds = tpl('feature-fill').instantiate(ctx(['CHAINSAW', 'LIGHT_BULLET'], { archetype: 'DIGGING' }))
    expect(seeds[0]).toContain('CHAINSAW')
  })

  it('no seed deck ever exceeds capacity (every template × archetype)', () => {
    const pool = ['NUKE', 'ADD_TRIGGER', 'BURST_3', 'LIGHT_BULLET', 'CHAINSAW', 'MAGIC_SHIELD', 'HOMING']
    for (const t of TEMPLATES) {
      for (const a of ARCHETYPES as readonly Archetype[]) {
        for (const deck of t.instantiate(ctx(pool, { capacity: 3, archetype: a }))) {
          expect(deck.length).toBeLessThanOrEqual(3)
        }
      }
    }
  })
})

describe('templates — respect owned-copy caps (no over-placement)', () => {
  it('spammer never places the cheapest projectile beyond its owned cap', () => {
    // own LIGHT_BULLET x1, BOMB x1; capacity 4 must NOT yield [LIGHT_BULLET x4]
    const seeds = tpl('spammer').instantiate(
      ctx(['LIGHT_BULLET', 'BOMB'], { capacity: 4, archetype: 'SPAM', caps: caps([['LIGHT_BULLET', 1], ['BOMB', 1]]) }),
    )
    expect(seeds).toHaveLength(1)
    expect(count(seeds[0], 'LIGHT_BULLET')).toBe(1)
    expect(count(seeds[0], 'BOMB')).toBe(1)
  })

  it('spammer spills to the next-cheapest once the cheapest is exhausted', () => {
    // own LIGHT_BULLET x2 (cheapest) then fall back to BOMB for the rest
    const seeds = tpl('spammer').instantiate(
      ctx(['LIGHT_BULLET', 'BOMB'], { capacity: 4, archetype: 'SPAM', caps: caps([['LIGHT_BULLET', 2], ['BOMB', 5]]) }),
    )
    expect(count(seeds[0], 'LIGHT_BULLET')).toBe(2)
    expect(count(seeds[0], 'BOMB')).toBe(2)
  })

  it('trigger-payload does not duplicate the carrier when only one projectile is owned', () => {
    // ADD_TRIGGER + a single owned NUKE -> [ADD_TRIGGER, NUKE], never [..., NUKE, NUKE]
    const seeds = tpl('trigger-payload').instantiate(
      ctx(['ADD_TRIGGER', 'NUKE'], { capacity: 6, caps: caps([['ADD_TRIGGER', 1], ['NUKE', 1]]) }),
    )
    expect(count(seeds[0], 'NUKE')).toBe(1)
  })

  it('feature-fill counts a dual-role spell (digger AND projectile) once under a cap of 1', () => {
    // CHAINSAW is both a digger and a type-0 projectile; owned x1 -> appears once total
    const seeds = tpl('feature-fill').instantiate(
      ctx(['CHAINSAW'], { capacity: 6, archetype: 'DIGGING', caps: caps([['CHAINSAW', 1]]) }),
    )
    expect(count(seeds[0], 'CHAINSAW')).toBe(1)
  })

  it('no template places any spell beyond a cap of 1 (every template × archetype)', () => {
    const pool = ['NUKE', 'ADD_TRIGGER', 'BURST_3', 'LIGHT_BULLET', 'CHAINSAW', 'MAGIC_SHIELD', 'HOMING']
    const cap1 = new Map(pool.map((id) => [id, 1] as [string, number]))
    for (const t of TEMPLATES) {
      for (const a of ARCHETYPES as readonly Archetype[]) {
        for (const deck of t.instantiate(ctx(pool, { capacity: 6, archetype: a, caps: cap1 }))) {
          const seen = new Map<string, number>()
          for (const id of deck) seen.set(id, (seen.get(id) ?? 0) + 1)
          for (const [id, n] of seen) {
            expect(n, `${t.id}/${a} placed ${id} x${n}`).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })
})
