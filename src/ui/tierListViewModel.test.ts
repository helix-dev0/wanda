import { describe, it, expect, beforeEach } from 'vitest'
import type { Wand, PerkRef } from '../schema/snapshot'
import { clearSimCache } from '../analysis/simCache'
import { tierListView } from './tierListViewModel'

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
const pool = new Set(['BUBBLESHOT', 'FLAMETHROWER', 'RUBBER_BALL', 'BOMB'])

const safe = makeWand({ slot: 0, spells: ['BUBBLESHOT'] })
const fire = makeWand({ slot: 1, spells: ['FLAMETHROWER'] })

describe('tierListView', () => {
  beforeEach(() => clearSimCache())

  it('empty held-wand list → empty view, no columns', () => {
    const v = tierListView([], [], pool)
    expect(v.empty).toBe(true)
    expect(v.columns).toEqual([])
  })

  it('produces one column per archetype, in order, each with the S–D ladder', () => {
    const v = tierListView([safe], [], pool)
    expect(v.columns.map((c) => c.archetype)).toEqual([
      'DAMAGE',
      'SPAM',
      'AOE',
      'MOBILITY',
      'DEFENSIVE',
    ])
    const ladder = v.columns[0].bands.map((b) => b.band)
    expect(ladder).toEqual(['S', 'A', 'B', 'C', 'D']) // no UNSAFE band when all safe
  })

  it('banishes a self-lethal wand to a separate UNSAFE band in every column', () => {
    const v = tierListView([safe, fire], [], pool)
    for (const col of v.columns) {
      const unsafe = col.bands.find((b) => b.band === 'UNSAFE')
      expect(unsafe).toBeDefined()
      expect(unsafe!.entries.map((e) => e.slot)).toEqual([1]) // the flamethrower wand
      // it still carries its would-be tier + the fixing perk
      expect(unsafe!.entries[0].fixableByPerk).toContain('PROTECTION_FIRE')
      expect(unsafe!.entries[0].tier).toMatch(/^[SABCD]$/)
      // the safe wand is NOT in UNSAFE
      const safeEntryInUnsafe = unsafe!.entries.some((e) => e.slot === 0)
      expect(safeEntryInUnsafe).toBe(false)
    }
  })

  it('Fire Immunity removes the wand from the UNSAFE band', () => {
    const v = tierListView([safe, fire], [perk('PROTECTION_FIRE')], pool)
    for (const col of v.columns) {
      expect(col.bands.some((b) => b.band === 'UNSAFE')).toBe(false)
    }
  })

  it('carries deck tiles and a suggestions feed per column', () => {
    const v = tierListView([safe], [], pool)
    const damage = v.columns[0]
    const dEntry = damage.bands.flatMap((b) => b.entries)[0]
    expect(dEntry.tiles).toHaveLength(1)
    expect(dEntry.tiles[0].name.length).toBeGreaterThan(0)
    expect(Array.isArray(damage.suggestions)).toBe(true)
  })
})
