import { createStore } from 'zustand/vanilla'
import type { Snapshot, Wand, SpellInventoryEntry, PerkRef, WorldSeen } from '../schema/snapshot'
// The pool-dedup key. Extracted to src/analysis so the M4 sim cache and this
// ledger dedup share ONE keying scheme (excludes slot + volatile mana).
import { wandKey as wandSignature } from '../analysis/wandKey'

/**
 * Run-state store + "seen this run" ledger (spec §3.2 module 2, plan M2-T2).
 *
 * Holds the current-frame mirror (wands / spell bag / perks / world-seen) plus a
 * ledger that ACCUMULATES the pool — every spell, perk, and wand observed since
 * the run began — so it persists even after an item leaves the active view, and
 * resets when `run_id` changes (a new run).
 *
 * The transition is a pure function (`applySnapshotToState`) so it is unit-tested
 * directly; the Zustand vanilla store is a thin wrapper around it (no React import
 * here — the UI binds via `useStore` at M2-T3, keeping this module Node-testable).
 *
 * Snapshots reaching the store are already schema-valid (they pass the M2-T1
 * ingestion boundary first), so the store trusts their shape and does not
 * re-validate.
 */

/** The pool of everything seen since the current run began. Cleared on run change. */
export interface RunLedger {
  /** Every spell action_id seen this run — from wand decks, always-cast slots,
   *  the loose bag, and world-visible shop/pedestal spells. The generation pool (M5). */
  readonly spells: ReadonlySet<string>
  /** Every perk id seen this run — acquired perks + Holy-Mountain offerings. */
  readonly perks: ReadonlySet<string>
  /** Distinct wands seen this run (held + pedestal), deduped by a structural
   *  signature. NOTE: the snapshot has no stable wand id yet (a real id is deferred
   *  to M1), so dedup keys on stable stats + loadout and excludes the volatile
   *  current `mana`. It can therefore over-count (same wand after a real stat
   *  change) or under-count (two wands identical in every modeled field) — good
   *  enough for the M2 pool; revisit when the mod emits a wand id. */
  readonly wands: readonly Wand[]
}

/** Current-frame run state, mirrored from the latest applied snapshot. */
export interface RunStateData {
  readonly runId: string | null
  readonly timestamp: number | null
  readonly wands: readonly Wand[]
  readonly spellInventory: readonly SpellInventoryEntry[]
  readonly perks: readonly PerkRef[]
  readonly worldSeen: WorldSeen | null
  readonly ledger: RunLedger
}

/** Store actions layered onto the data. */
export interface RunStateActions {
  /** Mirror a validated snapshot: reset the ledger if `run_id` changed, then set
   *  current state and fold the snapshot's spells/perks/wands into the pool. */
  applySnapshot: (snapshot: Snapshot) => void
  /** Clear everything back to the initial empty state. */
  reset: () => void
}

export type RunStore = RunStateData & RunStateActions

// --- pure helpers ------------------------------------------------------------

function emptyLedger(): RunLedger {
  return { spells: new Set(), perks: new Set(), wands: [] }
}

/** A fresh, fully-empty initial state (no shared mutable references). */
export function freshInitial(): RunStateData {
  return {
    runId: null,
    timestamp: null,
    wands: [],
    spellInventory: [],
    perks: [],
    worldSeen: null,
    ledger: emptyLedger(),
  }
}

/** Spell action_ids a single wand contributes (deck minus empties + always-cast). */
function spellsOfWand(w: Wand): string[] {
  return [...w.spells.filter((s): s is string => s !== null), ...w.always_cast]
}

/** Every spell action_id a snapshot exposes, across all sources. */
function spellsOfSnapshot(snap: Snapshot): string[] {
  const ids: string[] = []
  for (const w of snap.wands) ids.push(...spellsOfWand(w))
  for (const e of snap.spell_inventory) ids.push(e.action_id)
  if (snap.world_seen) {
    ids.push(...snap.world_seen.shop_spells)
    for (const w of snap.world_seen.pedestal_wands) ids.push(...spellsOfWand(w))
  }
  return ids
}

/** Every perk id a snapshot exposes (acquired + offered). */
function perksOfSnapshot(snap: Snapshot): string[] {
  const ids = snap.player.perks.map((p) => p.id)
  if (snap.world_seen) ids.push(...snap.world_seen.perk_offerings)
  return ids
}

/** Every wand a snapshot exposes (held + offered on pedestals). */
function wandsOfSnapshot(snap: Snapshot): readonly Wand[] {
  if (!snap.world_seen) return snap.wands
  return [...snap.wands, ...snap.world_seen.pedestal_wands]
}

// --- the reducer -------------------------------------------------------------

/** Pure run-state transition. Resets the ledger when `run_id` changes (incl. the
 *  first snapshot, where `state.runId` is null), then mirrors current state and
 *  accumulates the pool. Never mutates its inputs. */
export function applySnapshotToState(state: RunStateData, snap: Snapshot): RunStateData {
  const isNewRun = snap.run_id !== state.runId
  const base = isNewRun ? emptyLedger() : state.ledger

  const spells = new Set(base.spells)
  for (const id of spellsOfSnapshot(snap)) spells.add(id)

  const perks = new Set(base.perks)
  for (const id of perksOfSnapshot(snap)) perks.add(id)

  // Dedup wands by signature, preserving first-seen order.
  const bySig = new Map<string, Wand>()
  for (const w of base.wands) bySig.set(wandSignature(w), w)
  for (const w of wandsOfSnapshot(snap)) {
    const sig = wandSignature(w)
    if (!bySig.has(sig)) bySig.set(sig, w)
  }

  return {
    runId: snap.run_id,
    timestamp: snap.timestamp,
    wands: snap.wands,
    spellInventory: snap.spell_inventory,
    perks: snap.player.perks,
    worldSeen: snap.world_seen ?? null,
    ledger: { spells, perks, wands: [...bySig.values()] },
  }
}

// --- the store ---------------------------------------------------------------

/** Create an isolated run-state store (one per app; factory enables clean tests). */
export function createRunStore() {
  return createStore<RunStore>()((set) => ({
    ...freshInitial(),
    applySnapshot: (snapshot) => set((s) => applySnapshotToState(s, snapshot)),
    reset: () => set(() => freshInitial()),
  }))
}

/** Type of the store handle (getState / setState / subscribe / getInitialState). */
export type RunStoreApi = ReturnType<typeof createRunStore>

/** The app-wide run-state store. The UI binds to it via `useStore` (M2-T3). */
export const runStore = createRunStore()
