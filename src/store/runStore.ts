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

/** Where a pooled spell was observed this run (spec §6.5 provenance, Option A). */
export type ItemOrigin = 'owned' | 'shop' | 'pedestal' | 'holy_mountain'

/** Accumulated origin + freshness for one pooled spell, so Prescribe can say where
 *  to grab it ("from your bag" / "in the shop") and whether it is on screen now. */
export interface ProvenanceEntry {
  /** Most actionable origin seen, by precedence owned > pedestal > shop > holy_mountain. */
  readonly origin: ItemOrigin
  /** Every distinct origin this spell has been observed from this run. */
  readonly origins: readonly ItemOrigin[]
  /** True iff the spell appeared in the LATEST applied snapshot ("on screen now"). */
  readonly fresh: boolean
  /** Snapshot timestamps first/last observed (for "seen earlier this run" framing). */
  readonly firstSeen: number
  readonly lastSeen: number
}

/** The pool of everything seen since the current run began. Cleared on run change. */
export interface RunLedger {
  /** Every spell action_id seen this run — from wand decks, always-cast slots,
   *  the loose bag, and world-visible shop/pedestal spells. The generation pool (M5). */
  readonly spells: ReadonlySet<string>
  /** Per-spell origin + freshness for the spells above (spec §6.5 provenance). */
  readonly provenance: ReadonlyMap<string, ProvenanceEntry>
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

const ORIGIN_RANK: Record<ItemOrigin, number> = { owned: 3, pedestal: 2, shop: 1, holy_mountain: 0 }

/** The most actionable origin among those seen, by ORIGIN_RANK precedence. */
function primaryOrigin(origins: readonly ItemOrigin[]): ItemOrigin {
  return origins.reduce((best, o) => (ORIGIN_RANK[o] > ORIGIN_RANK[best] ? o : best))
}

function emptyLedger(): RunLedger {
  return { spells: new Set(), perks: new Set(), wands: [], provenance: new Map() }
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

/** Every spell action_id a snapshot exposes, tagged with where it was observed:
 *  owned (held decks + always-cast + loose bag), shop, or pedestal. The single
 *  source enumeration — both the pool Set and the provenance map derive from it, so
 *  they cannot drift. (A spell can appear more than once with different origins.) */
function taggedSpellsOfSnapshot(snap: Snapshot): { id: string; origin: ItemOrigin }[] {
  const out: { id: string; origin: ItemOrigin }[] = []
  for (const w of snap.wands) for (const id of spellsOfWand(w)) out.push({ id, origin: 'owned' })
  for (const e of snap.spell_inventory) out.push({ id: e.action_id, origin: 'owned' })
  if (snap.world_seen) {
    for (const id of snap.world_seen.shop_spells) out.push({ id, origin: 'shop' })
    for (const w of snap.world_seen.pedestal_wands)
      for (const id of spellsOfWand(w)) out.push({ id, origin: 'pedestal' })
  }
  return out
}

/** Every spell action_id a snapshot exposes (origins collapsed). */
function spellsOfSnapshot(snap: Snapshot): string[] {
  return taggedSpellsOfSnapshot(snap).map((t) => t.id)
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

/** Accumulate provenance: extend each spell's origins, and recompute freshness so
 *  exactly the spells in THIS snapshot are "fresh" (on screen now). Pure — builds a
 *  new Map with new entries, never mutates `base`. */
function foldProvenance(
  base: ReadonlyMap<string, ProvenanceEntry>,
  snap: Snapshot,
): Map<string, ProvenanceEntry> {
  const ts = snap.timestamp
  const tagged = taggedSpellsOfSnapshot(snap)
  const freshIds = new Set(tagged.map((t) => t.id))

  // Carry base entries forward, recomputing freshness against this snapshot.
  const next = new Map<string, ProvenanceEntry>()
  for (const [id, e] of base) {
    const fresh = freshIds.has(id)
    next.set(id, e.fresh === fresh ? e : { ...e, fresh })
  }

  // Fold this snapshot's spells: extend origins, mark fresh, bump lastSeen.
  for (const { id, origin } of tagged) {
    const prev = next.get(id)
    if (!prev) {
      next.set(id, { origin, origins: [origin], fresh: true, firstSeen: ts, lastSeen: ts })
    } else {
      const origins = prev.origins.includes(origin) ? prev.origins : [...prev.origins, origin]
      next.set(id, {
        origin: primaryOrigin(origins),
        origins,
        fresh: true,
        firstSeen: prev.firstSeen,
        lastSeen: ts,
      })
    }
  }
  return next
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

  const provenance = foldProvenance(base.provenance, snap)

  return {
    runId: snap.run_id,
    timestamp: snap.timestamp,
    wands: snap.wands,
    spellInventory: snap.spell_inventory,
    perks: snap.player.perks,
    worldSeen: snap.world_seen ?? null,
    ledger: { spells, provenance, perks, wands: [...bySig.values()] },
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
