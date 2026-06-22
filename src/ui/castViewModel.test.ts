import { describe, it, expect } from 'vitest'
import { parseSnapshot, type Wand } from '../schema/snapshot'
import { castView } from './castViewModel'

const fixtures = import.meta.glob('../data/fixtures/snapshot_*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const heldWand = (suffix: string): Wand => {
  const key = Object.keys(fixtures).find((k) => k.endsWith('/' + suffix))
  if (!key) throw new Error(`fixture not found: ${suffix}`)
  return parseSnapshot(fixtures[key]).wands[0]
}

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

describe('castView — fixtures', () => {
  it('snapshot_03 (BUBBLESHOT ×3): 3 casts, each a Bubble Spark projectile tile', () => {
    const v = castView(heldWand('snapshot_03.json'))
    expect(v.empty).toBe(false)
    expect(v.title).toBe('Held wand')
    expect(v.shots).toHaveLength(3)
    const node = v.shots[0].projectiles[0]
    expect(node.id).toBe('BUBBLESHOT')
    expect(node.count).toBe(1)
    expect(node.tile.typeClass).toBe('projectile')
    expect(node.tile.name.length).toBeGreaterThan(0)
    expect(node.children).toEqual([])
    // metrics surface (rows present + labeled)
    expect(v.metrics.find((r) => r.key === 'sustainedDps')?.value).toMatch(/HP\/s$/)
    expect(v.metrics.find((r) => r.key === 'aoe')?.value).toBe('4 px')
  })

  it('snapshot_01 + snapshot_02 produce non-empty, non-approximate casts', () => {
    for (const s of ['snapshot_01.json', 'snapshot_02.json']) {
      const v = castView(heldWand(s))
      expect(v.empty).toBe(false)
      expect(v.approximate).toBe(false)
      expect(v.shots.length).toBeGreaterThan(0)
    }
  })
})

describe('castView — condense/combineGroups grouping (lightly tested upstream)', () => {
  it('a multicast of 3 identical projectiles in ONE shot collapses to a single node with count 3', () => {
    // spellsPerCast 3 → all three BUBBLESHOTs fire in one shot → condense groups them.
    const wand = makeWand({
      spells: ['BUBBLESHOT', 'BUBBLESHOT', 'BUBBLESHOT'],
      stats: { ...makeWand().stats, spellsPerCast: 3, capacity: 3 },
    })
    const v = castView(wand)
    expect(v.shots).toHaveLength(1)
    expect(v.shots[0].projectiles).toHaveLength(1)
    expect(v.shots[0].projectiles[0]).toMatchObject({ id: 'BUBBLESHOT', count: 3 })
  })

  it('distinct projectiles in one shot are NOT collapsed', () => {
    const wand = makeWand({
      spells: ['BUBBLESHOT', 'RUBBER_BALL', 'GRENADE'],
      stats: { ...makeWand().stats, spellsPerCast: 3, capacity: 3 },
    })
    const v = castView(wand)
    expect(v.shots).toHaveLength(1)
    const ids = v.shots[0].projectiles.map((p) => p.id)
    expect(ids).toEqual(['BUBBLESHOT', 'RUBBER_BALL', 'GRENADE'])
    expect(v.shots[0].projectiles.every((p) => p.count === 1)).toBe(true)
  })
})

describe('castView — guards', () => {
  it('empty deck → empty view, no shots', () => {
    const v = castView(makeWand({ spells: [null, null] }))
    expect(v.empty).toBe(true)
    expect(v.shots).toEqual([])
  })

  it('modded spell id → approximate, surfaced in missingSpells', () => {
    const v = castView(makeWand({ spells: ['ZZZ_MODDED', 'BUBBLESHOT'] }))
    expect(v.approximate).toBe(true)
    expect(v.missingSpells).toEqual(['ZZZ_MODDED'])
  })
})
