import { describe, it, expect, beforeEach } from 'vitest'
import type { Wand, PerkRef } from '../schema/snapshot'
import { clearSimCache } from '../analysis/simCache'
import { tierListView, type TierListView } from './tierListViewModel'
import { generate } from '../generation/generate'
import type { ProvenanceEntry } from '../store/runStore'

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

describe('tierListView — dial + generated builds (M5)', () => {
  beforeEach(() => clearSimCache())

  const held0 = makeWand({ slot: 0, spells: ['BUBBLESHOT'] })
  const genPool = ['NUKE', 'DAMAGE', 'LIGHT_BULLET', 'ADD_TRIGGER'] // offensive only
  const genResult = () => generate({ pool: genPool, chassis: makeWand({ spells: [] }), perks: [], constraints: {} })
  const entriesOf = (v: TierListView) => v.columns.flatMap((c) => c.bands.flatMap((b) => b.entries))

  it('merges generated builds into the bands at Suggest, marked source=generated', () => {
    const v = tierListView([held0], [], pool, { generated: genResult(), rung: 'suggest' })
    const damage = v.columns[0].bands.flatMap((b) => b.entries)
    expect(damage.some((e) => e.source === 'generated')).toBe(true)
    expect(damage.some((e) => e.source === 'held')).toBe(true)
  })

  it('Mirror hides generated builds and shows metrics but no advice', () => {
    const v = tierListView([held0], [], pool, { generated: genResult(), rung: 'mirror' })
    const entries = entriesOf(v)
    expect(entries.every((e) => e.source === 'held')).toBe(true)
    expect(entries[0].reveal.metrics).toBe(true)
    expect(entries[0].reveal.reasons).toBe(false)
    expect(entries[0].reveal.generated).toBe(false)
    expect(v.columns.every((c) => c.suggestions.length === 0)).toBe(true) // no advice at Mirror
  })

  it('Teach reveals the mechanic "why" on a generated build', () => {
    const v = tierListView([held0], [], pool, { generated: genResult(), rung: 'teach' })
    const gen = entriesOf(v).find((e) => e.source === 'generated')
    expect(gen?.reveal.teach).toBe(true)
    expect(gen?.teach).toBeTruthy()
  })

  it('Prescribe reveals per-slot provenance and stays terse', () => {
    const v = tierListView([held0], [], pool, { generated: genResult(), rung: 'prescribe' })
    const e = entriesOf(v)[0]
    expect(e.reveal.provenance).toBe(true)
    expect(e.reveal.metrics).toBe(false) // terse — no metric prose
  })

  it('a drilled card is shaped to Prescribe while others follow the global rung', () => {
    const g = genResult()
    const probe = tierListView([held0], [], pool, { generated: g, rung: 'suggest' })
    const targetKey = probe.columns[0].bands.flatMap((b) => b.entries)[0].key

    const v = tierListView([held0], [], pool, {
      generated: g,
      rung: 'suggest',
      drilled: new Set([targetKey]),
    })
    const entries = v.columns[0].bands.flatMap((b) => b.entries)
    const drilledEntry = entries.find((e) => e.key === targetKey)
    expect(drilledEntry?.drilled).toBe(true)
    expect(drilledEntry?.reveal.provenance).toBe(true) // forced to Prescribe
    const other = entries.find((e) => e.key !== targetKey)
    if (other) expect(other.reveal.provenance).toBe(false) // still Suggest
  })

  it('stamps "go grab X" provenance onto held-wand tiles', () => {
    const provenance: ReadonlyMap<string, ProvenanceEntry> = new Map([
      ['BUBBLESHOT', { origin: 'owned', origins: ['owned'], fresh: true, firstSeen: 0, lastSeen: 0 }],
    ])
    const v = tierListView([held0], [], pool, { provenance, rung: 'prescribe' })
    const e = entriesOf(v).find((x) => x.source === 'held')
    expect(e?.provenance?.[0]).toEqual({ text: 'your bag', kind: 'owned' })
  })

  it('surfaces a generation note for an archetype it cannot build', () => {
    const v = tierListView([held0], [], pool, { generated: genResult(), rung: 'suggest' })
    const defensive = v.columns.find((c) => c.archetype === 'DEFENSIVE')
    expect(defensive?.note).toBeTruthy() // no defensive spells in the gen pool
    expect(defensive?.bands.every((b) => b.entries.every((e) => e.source !== 'generated'))).toBe(true)
  })

  it('with no opts, behaves exactly as the M4 held-wand view (Suggest default)', () => {
    const v = tierListView([held0], [], pool)
    expect(v.rung).toBe('suggest')
    expect(entriesOf(v).every((e) => e.source === 'held')).toBe(true)
    expect(v.columns[0].suggestions).toBeDefined()
  })
})

describe('tierListView — multiple carried wands + active flag (M1-T2)', () => {
  beforeEach(() => clearSimCache())

  it('titles the active-flagged wand "Held wand" even when it is not slot 0', () => {
    const w0 = makeWand({ slot: 0, spells: ['BUBBLESHOT'] })
    const w1 = makeWand({ slot: 1, active: true, spells: ['BUBBLESHOT'] })
    const v = tierListView([w0, w1], [], pool)
    const entries = v.columns.flatMap((c) => c.bands.flatMap((b) => b.entries))
    const held = entries.filter((e) => e.title === 'Held wand') // one per archetype column
    expect(held.length).toBeGreaterThan(0)
    expect(held.every((e) => e.slot === 1)).toBe(true) // the active wand, not slot 0
    expect(entries.some((e) => e.title === 'Wand · slot 0')).toBe(true)
  })
})
