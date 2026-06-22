import { describe, it, expect, beforeEach } from 'vitest'
import type { Wand, PerkRef } from '../schema/snapshot'
import { clearSimCache } from './simCache'
import { suggestEdits } from './suggestions'

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

describe('suggestEdits — improvement', () => {
  beforeEach(() => clearSimCache())

  it('ranks a score-raising swap first', () => {
    // A mana-limited grenade is a poor spammer; swapping in a sustainable spam
    // spell from the pool raises the SPAM score.
    const wand = makeWand({ spells: ['GRENADE'] })
    const pool = new Set(['GRENADE', 'BUBBLESHOT', 'RUBBER_BALL'])
    const out = suggestEdits(wand, 'SPAM', pool, [])
    expect(out.length).toBeGreaterThan(0)
    expect(out[0].edit.kind).toBe('swap')
    expect(out[0].deltaScore).toBeGreaterThan(0)
    expect(out[0].label).toMatch(/^Swap /)
  })

  it('collapses equivalent edits to one suggestion (no duplicate labels)', () => {
    // Three identical slots → "Swap Bubbleshot → Nuke" must appear once, not 3×.
    const wand = makeWand({ spells: ['BUBBLESHOT', 'BUBBLESHOT', 'BUBBLESHOT'] })
    const pool = new Set(['BUBBLESHOT', 'NUKE', 'GRENADE'])
    const labels = suggestEdits(wand, 'DAMAGE', pool, []).map((s) => s.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('is sorted by descending benefit', () => {
    const wand = makeWand({ spells: ['GRENADE'] })
    const pool = new Set(['GRENADE', 'BUBBLESHOT', 'RUBBER_BALL'])
    const out = suggestEdits(wand, 'SPAM', pool, [])
    const ranks = out.map((s) => s.deltaScore)
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks)
  })
})

describe('suggestEdits — self-danger interaction', () => {
  beforeEach(() => clearSimCache())

  it('surfaces an edit that removes a lethal hazard', () => {
    // A flamethrower wand is fire-unsafe; swapping it out clears the hazard.
    const wand = makeWand({ spells: ['FLAMETHROWER'] })
    const pool = new Set(['FLAMETHROWER', 'BUBBLESHOT'])
    const out = suggestEdits(wand, 'SPAM', pool, [])
    const fix = out.find((s) => s.fixesHazard === 'FIRE')
    expect(fix).toBeDefined()
    expect(fix?.edit).toMatchObject({ kind: 'swap', to: 'BUBBLESHOT' })
  })

  it('VETOes an edit that would introduce a new danger', () => {
    // Swapping a safe spark for a point-blank bomb raises AoE but is self-lethal.
    const wand = makeWand({ spells: ['BUBBLESHOT'] })
    const pool = new Set(['BUBBLESHOT', 'BOMB'])
    const out = suggestEdits(wand, 'AOE', pool, [])
    expect(out.some((s) => s.edit.kind === 'swap' && s.edit.to === 'BOMB')).toBe(false)
  })

  it('…but allows that same swap once the player has Explosion Immunity', () => {
    const wand = makeWand({ spells: ['BUBBLESHOT'] })
    const pool = new Set(['BUBBLESHOT', 'BOMB'])
    const out = suggestEdits(wand, 'AOE', pool, [perk('PROTECTION_EXPLOSION')])
    expect(out.some((s) => s.edit.kind === 'swap' && s.edit.to === 'BOMB')).toBe(true)
  })
})

describe('suggestEdits — guards', () => {
  beforeEach(() => clearSimCache())

  it('an empty pool yields no swaps', () => {
    const out = suggestEdits(makeWand({ spells: ['BUBBLESHOT'] }), 'SPAM', new Set(), [])
    expect(out.every((s) => s.edit.kind !== 'swap')).toBe(true)
  })

  it('an empty deck yields nothing', () => {
    expect(suggestEdits(makeWand({ spells: [null, null] }), 'DAMAGE', new Set(['BOMB']), [])).toEqual(
      [],
    )
  })
})
