import { describe, it, expect } from 'vitest'
import * as v from 'valibot'
import { SnapshotSchema, parseSnapshot, type Snapshot } from './snapshot'

// A hand-written, schema-shaped snapshot covering the important shapes:
// shuffle + multicast wand, non-shuffle wand with always-cast + null empty slots,
// acquired perks with stack counts, a loose spell bag with limited + unlimited
// uses, and the optional world_seen block. Built fresh each call so malformed
// cases can mutate a clone without bleeding into other tests.
function makeValidSnapshot(): Snapshot {
  return {
    schema: 1,
    run_id: 'seed-1234567890',
    timestamp: 480123,
    player: {
      perks: [
        { id: 'PROTECTION_FIRE', stacks: 1 },
        { id: 'EXTRA_HP', stacks: 3 },
      ],
    },
    wands: [
      {
        slot: 0,
        stats: {
          shuffle: true,
          spellsPerCast: 2,
          castDelay: 6,
          rechargeTime: 25,
          manaMax: 500,
          mana: 500,
          manaChargeSpeed: 300,
          capacity: 12,
          spread: 4,
          speedMultiplier: 1,
        },
        always_cast: [],
        spells: ['DAMAGE', 'DOUBLE_SPELL', 'BLACK_HOLE'],
      },
      {
        slot: 1,
        stats: {
          shuffle: false,
          spellsPerCast: 1,
          castDelay: 6,
          rechargeTime: 25,
          manaMax: 240,
          mana: 130,
          manaChargeSpeed: 100,
          capacity: 6,
          spread: -13.2, // spread can be negative (EZWand: e.g. -13.2 deg)
          speedMultiplier: 1,
        },
        always_cast: ['ADD_TRIGGER'],
        spells: ['LIGHT_BULLET', null, 'BOUNCE', null], // null = empty slot
      },
    ],
    spell_inventory: [
      { action_id: 'BOMB', uses_remaining: 3 },
      { action_id: 'LIGHT_BULLET', uses_remaining: null }, // null = unlimited
    ],
    world_seen: {
      shop_spells: ['CHAINSAW', 'LUMINOUS_DRILL'],
      pedestal_wands: [],
      perk_offerings: ['PROJECTILE_REPULSION', 'VAMPIRISM'],
    },
  }
}

/** All field-level error paths for a value, e.g. ['wands.0.stats.manaMax']. */
function errorPaths(data: unknown): string[] {
  const result = v.safeParse(SnapshotSchema, data)
  expect(result.success).toBe(false)
  return result.issues!.map((issue) => v.getDotPath(issue)).filter((p): p is string => p !== null)
}

describe('SnapshotSchema', () => {
  it('parses a valid snapshot and preserves values', () => {
    const snap = parseSnapshot(makeValidSnapshot()) // throws if invalid
    expect(snap.run_id).toBe('seed-1234567890')
    expect(snap.wands[0].stats.shuffle).toBe(true)
    expect(snap.wands[1].spells).toEqual(['LIGHT_BULLET', null, 'BOUNCE', null])
    expect(snap.wands[1].stats.spread).toBe(-13.2)
    expect(snap.player.perks[1]).toEqual({ id: 'EXTRA_HP', stacks: 3 })
    expect(snap.spell_inventory[1].uses_remaining).toBeNull()
  })

  it('treats world_seen as optional', () => {
    const input = makeValidSnapshot()
    delete input.world_seen
    expect(v.safeParse(SnapshotSchema, input).success).toBe(true)
  })

  it('rejects a missing wand stat with a field-level error (manaMax)', () => {
    const input = makeValidSnapshot()
    // @ts-expect-error deliberately constructing an invalid value
    delete input.wands[0].stats.manaMax
    expect(errorPaths(input)).toContain('wands.0.stats.manaMax')
  })

  it('rejects a wrong-typed stat with a field-level error (shuffle as string)', () => {
    const input = makeValidSnapshot()
    // @ts-expect-error deliberately constructing an invalid value
    input.wands[0].stats.shuffle = 'false'
    expect(errorPaths(input)).toContain('wands.0.stats.shuffle')
  })

  it('rejects a bad schema version (literal 1 enforced)', () => {
    const input = makeValidSnapshot()
    // @ts-expect-error deliberately constructing an invalid value
    input.schema = 2
    expect(errorPaths(input)).toContain('schema')
  })

  it('rejects a perk missing its id', () => {
    const input = makeValidSnapshot()
    // @ts-expect-error deliberately constructing an invalid value
    delete input.player.perks[0].id
    expect(errorPaths(input)).toContain('player.perks.0.id')
  })

  it('rejects a non-string in a spell slot (only string | null allowed)', () => {
    const input = makeValidSnapshot()
    // @ts-expect-error deliberately constructing an invalid value
    input.wands[0].spells[1] = 42
    expect(errorPaths(input)).toContain('wands.0.spells.1')
  })
})
