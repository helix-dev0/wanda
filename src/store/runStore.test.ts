import { describe, it, expect } from 'vitest'
import { ingestSnapshot } from '../ingestion/ingest'
import { applySnapshotToState, createRunStore, freshInitial } from './runStore'
import type { Snapshot, Wand } from '../schema/snapshot'

// M2-T2: the run-state store + "seen this run" ledger (spec §3.2 module 2).
// Pure reducer is tested directly; the vanilla store is exercised for the
// getState/subscribe contract. Snapshots are produced by ingesting the real
// fixtures (dogfoods M2-T1); run-change + world_seen cases use synthetic ids
// because all captured fixtures collide on run_id "run-10" (progress.md flag).
const fixtures = import.meta.glob('../data/fixtures/snapshot_*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const raw = (suffix: string): unknown => {
  const key = Object.keys(fixtures).find((k) => k.endsWith('/' + suffix))
  if (key === undefined) throw new Error(`fixture not found: ${suffix}`)
  return fixtures[key]
}
const load = (suffix: string): Snapshot => {
  const r = ingestSnapshot(raw(suffix))
  if (!r.ok) throw new Error(`fixture failed to ingest: ${suffix}`)
  return r.snapshot
}
const apply = (snap: Snapshot, state = freshInitial()) => applySnapshotToState(state, snap)

describe('applySnapshotToState — mirrors current frame state', () => {
  it('initializes run + current state from the first snapshot', () => {
    const s = apply(load('snapshot_01.json'))
    expect(s.runId).toBe('run-10')
    expect(s.timestamp).toBe(656)
    expect(s.wands).toHaveLength(1)
    expect(s.wands[0].spells).toEqual(['RUBBER_BALL', 'RUBBER_BALL'])
    expect(s.spellInventory).toEqual([])
    expect(s.worldSeen).toBeNull()
  })

  it('replaces current wands + bag with the latest snapshot', () => {
    let s = apply(load('snapshot_01.json'))
    s = apply(load('snapshot_02.json'), s)
    // current view is snapshot_02: the GRENADE wand + the 2x NUKE bag
    expect(s.wands[0].spells).toEqual(['GRENADE', null])
    expect(s.spellInventory.map((e) => e.action_id)).toEqual(['NUKE', 'NUKE'])
  })
})

describe('seen-this-run ledger — accumulates the pool across snapshots', () => {
  it('accumulates spells even after they leave the active view', () => {
    let s = apply(load('snapshot_01.json')) // RUBBER_BALL on the wand
    s = apply(load('snapshot_02.json'), s) // wand is now GRENADE; bag has NUKE
    // RUBBER_BALL is gone from the current wand but persists in the pool
    expect([...s.ledger.spells].sort()).toEqual(['GRENADE', 'NUKE', 'RUBBER_BALL'])
  })

  it('retains a spell in the pool after it vanishes from the entire snapshot', () => {
    // RUBBER_BALL appears only in snapshot_01; snapshot_02 contains it nowhere.
    // This is the ledger's headline promise: the pool outlives the live view.
    let s = apply(load('snapshot_01.json'))
    s = apply(load('snapshot_02.json'), s)
    expect(s.wands.flatMap((w) => w.spells)).not.toContain('RUBBER_BALL')
    expect(s.spellInventory.map((e) => e.action_id)).not.toContain('RUBBER_BALL')
    expect(s.ledger.spells.has('RUBBER_BALL')).toBe(true)
  })

  it('builds the full spell pool over all three fixtures', () => {
    let s = freshInitial()
    for (const f of ['snapshot_01.json', 'snapshot_02.json', 'snapshot_03.json']) {
      s = apply(load(f), s)
    }
    expect([...s.ledger.spells].sort()).toEqual(['BUBBLESHOT', 'GRENADE', 'NUKE', 'RUBBER_BALL'])
  })

  it('dedups repeated spells (BUBBLESHOT x3 in one deck counts once)', () => {
    const s = apply(load('snapshot_03.json'))
    // deck is BUBBLESHOT x3 + a 2x NUKE bag -> the pool holds each id exactly once
    expect([...s.ledger.spells].sort()).toEqual(['BUBBLESHOT', 'NUKE'])
  })

  it('accumulates distinct wands across the three fixtures', () => {
    let s = freshInitial()
    for (const f of ['snapshot_01.json', 'snapshot_02.json', 'snapshot_03.json']) {
      s = apply(load(f), s)
    }
    expect(s.ledger.wands).toHaveLength(3)
  })

  it('treats the same snapshot applied twice as idempotent', () => {
    const snap = load('snapshot_01.json')
    let s = apply(snap)
    s = apply(snap, s)
    expect([...s.ledger.spells]).toEqual(['RUBBER_BALL'])
    expect(s.ledger.wands).toHaveLength(1)
  })

  it('dedups one wand seen across frames with only its current mana changed', () => {
    const a = load('snapshot_01.json')
    const b = structuredClone(a)
    b.wands[0].stats.mana = 1 // volatile field only — same wand
    let s = apply(a)
    s = apply(b, s)
    expect(s.ledger.wands).toHaveLength(1)
  })

  it('dedups a wand even when its stat keys arrive in a different order', () => {
    // The cross-platform emitters (Linux maintainer vs Windows co-player) may
    // serialize the stats table in a different key order; the signature must not
    // depend on it, or the same wand double-counts in the pool.
    const a = load('snapshot_01.json')
    const b = structuredClone(a)
    const reordered = Object.fromEntries(Object.entries(b.wands[0].stats).reverse())
    b.wands[0].stats = reordered as Wand['stats']
    let s = apply(a)
    s = apply(b, s)
    expect(s.ledger.wands).toHaveLength(1)
  })

  it('accumulates perks (acquired) and dedups by id while current stacks update', () => {
    const a = structuredClone(load('snapshot_01.json'))
    a.player.perks = [{ id: 'PROTECTION_FIRE', stacks: 1 }]
    const b = structuredClone(a)
    b.player.perks = [{ id: 'PROTECTION_FIRE', stacks: 2 }]
    let s = apply(a)
    s = apply(b, s)
    expect([...s.ledger.perks]).toEqual(['PROTECTION_FIRE'])
    expect(s.perks).toEqual([{ id: 'PROTECTION_FIRE', stacks: 2 }]) // current reflects stacks
  })

  it('folds world_seen (shop spells, pedestal wands, perk offerings) into the pool', () => {
    const snap = structuredClone(load('snapshot_01.json'))
    const pedestalWand: Wand = {
      slot: 99,
      stats: { ...snap.wands[0].stats },
      always_cast: [],
      spells: ['LUMINOUS_DRILL'],
    }
    snap.world_seen = {
      shop_spells: ['CHAINSAW'],
      pedestal_wands: [pedestalWand],
      perk_offerings: ['VAMPIRISM'],
    }
    const s = apply(snap)
    expect(s.ledger.spells.has('CHAINSAW')).toBe(true)
    expect(s.ledger.spells.has('LUMINOUS_DRILL')).toBe(true)
    expect(s.ledger.perks.has('VAMPIRISM')).toBe(true)
    expect(s.worldSeen?.shop_spells).toEqual(['CHAINSAW'])
  })

  it('retains world-seen items in the pool after world_seen is dropped', () => {
    const a = structuredClone(load('snapshot_01.json'))
    a.world_seen = { shop_spells: ['CHAINSAW'], pedestal_wands: [], perk_offerings: ['VAMPIRISM'] }
    const b = structuredClone(load('snapshot_01.json')) // same run, no world_seen
    let s = apply(a)
    s = apply(b, s)
    expect(s.worldSeen).toBeNull() // current-frame view clears
    expect(s.ledger.spells.has('CHAINSAW')).toBe(true) // pool retains
    expect(s.ledger.perks.has('VAMPIRISM')).toBe(true)
  })
})

describe('run change resets the ledger', () => {
  it('clears the pool when run_id changes', () => {
    const first = load('snapshot_01.json') // run-10, RUBBER_BALL
    const second = structuredClone(load('snapshot_03.json')) // BUBBLESHOT
    second.run_id = 'run-99' // synthetic new run
    let s = apply(first)
    s = apply(second, s)
    expect(s.runId).toBe('run-99')
    // pool was reset: only snapshot_03's spells (BUBBLESHOT deck + NUKE bag) remain
    expect([...s.ledger.spells].sort()).toEqual(['BUBBLESHOT', 'NUKE'])
    expect(s.ledger.spells.has('RUBBER_BALL')).toBe(false)
    expect(s.ledger.wands).toHaveLength(1)
  })

  it('keeps accumulating while run_id is unchanged', () => {
    const a = load('snapshot_01.json')
    const b = load('snapshot_02.json') // same run-10
    let s = apply(a)
    s = apply(b, s)
    expect(s.ledger.spells.size).toBe(3) // RUBBER_BALL, GRENADE, NUKE
  })
})

describe('createRunStore — vanilla store integration', () => {
  it('starts at the initial state', () => {
    const store = createRunStore()
    expect(store.getState().runId).toBeNull()
    expect(store.getState().ledger.spells.size).toBe(0)
  })

  it('applySnapshot updates getState and notifies subscribers', () => {
    const store = createRunStore()
    let notified = 0
    const unsub = store.subscribe(() => notified++)
    store.getState().applySnapshot(load('snapshot_01.json'))
    unsub()
    expect(notified).toBeGreaterThan(0)
    expect(store.getState().runId).toBe('run-10')
    expect([...store.getState().ledger.spells]).toEqual(['RUBBER_BALL'])
  })

  it('reset() returns the store to the initial state', () => {
    const store = createRunStore()
    store.getState().applySnapshot(load('snapshot_03.json'))
    store.getState().reset()
    expect(store.getState().runId).toBeNull()
    expect(store.getState().ledger.spells.size).toBe(0)
    expect(store.getState().wands).toEqual([])
  })
})
