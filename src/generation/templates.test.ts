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
