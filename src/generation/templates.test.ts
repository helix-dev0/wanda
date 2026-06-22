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

  it('spammer fills capacity with the cheapest projectile', () => {
    // CHAINSAW(1) < BOMB(25)
    expect(tpl('spammer').instantiate(ctx(['BOMB', 'CHAINSAW'], { capacity: 3, archetype: 'SPAM' }))).toEqual([
      ['CHAINSAW', 'CHAINSAW', 'CHAINSAW'],
    ])
  })

  it('multicast-stack leads with the multicast spell', () => {
    const seeds = tpl('multicast-stack').instantiate(
      ctx(['BURST_3', 'LIGHT_BULLET'], { capacity: 4, archetype: 'AOE' }),
    )
    expect(seeds[0][0]).toBe('BURST_3')
  })

  it('feature-fill includes the archetype feature spells', () => {
    const seeds = tpl('feature-fill').instantiate(ctx(['CHAINSAW', 'LIGHT_BULLET'], { archetype: 'MOBILITY' }))
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
    // own CHAINSAW x1, BOMB x1; capacity 4 must NOT yield [CHAINSAW x4]
    const seeds = tpl('spammer').instantiate(
      ctx(['CHAINSAW', 'BOMB'], { capacity: 4, archetype: 'SPAM', caps: caps([['CHAINSAW', 1], ['BOMB', 1]]) }),
    )
    expect(seeds).toHaveLength(1)
    expect(count(seeds[0], 'CHAINSAW')).toBe(1)
    expect(count(seeds[0], 'BOMB')).toBe(1)
  })

  it('spammer spills to the next-cheapest once the cheapest is exhausted', () => {
    // own CHAINSAW x2 (cheapest) then fall back to BOMB for the rest
    const seeds = tpl('spammer').instantiate(
      ctx(['CHAINSAW', 'BOMB'], { capacity: 4, archetype: 'SPAM', caps: caps([['CHAINSAW', 2], ['BOMB', 5]]) }),
    )
    expect(count(seeds[0], 'CHAINSAW')).toBe(2)
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
      ctx(['CHAINSAW'], { capacity: 6, archetype: 'MOBILITY', caps: caps([['CHAINSAW', 1]]) }),
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
