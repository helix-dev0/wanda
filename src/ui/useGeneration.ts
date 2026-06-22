import { useEffect } from 'react'
import { uiStore } from '../store/uiStore'
import { ownedCounts } from '../store/runStore'
import { useRunStore } from './useRunStore'
import { useUiStore } from './useUiStore'
import { requestGenerate } from '../generation/workerClient'
import { activeWand } from './viewModel'
import { spellDb } from '../data/spellDb'
import type { Wand } from '../schema/snapshot'

/** An idealized chassis for theorycraft mode / when no wand is held: roomy and
 *  unshuffled, so generation has space to build and order-dependent templates apply. */
const IDEAL_CHASSIS: Wand = {
  slot: 0,
  always_cast: [],
  spells: [],
  stats: {
    shuffle: false,
    spellsPerCast: 1,
    castDelay: 10,
    rechargeTime: 25,
    manaMax: 1000,
    mana: 1000,
    manaChargeSpeed: 300,
    capacity: 8,
    spread: 0,
    speedMultiplier: 1,
  },
}

/** All candidate chassis for owned-mode generation: EVERY carried wand, the held/
 *  active one FIRST (it gets first share of the per-archetype search budget and is
 *  the most likely "rebuild what I'm holding" answer), then the rest in slot order.
 *  Empty → the idealized chassis so generation still has a base. This is the chassis-
 *  selection fix: builds are no longer confined to the held wand, so a roomier owned
 *  wand can win an archetype ("build the best wand from MY spells"). */
function ownedChassis(wands: readonly Wand[]): Wand[] {
  if (wands.length === 0) return [IDEAL_CHASSIS]
  const held = activeWand(wands)
  const rest = wands.filter((w) => w !== held).sort((a, b) => a.slot - b.slot)
  return held ? [held, ...rest] : [...rest]
}

/**
 * Debounced generation driver (M5-T3). Watches the held wands / bag / perks / dial
 * inputs and, off the UI thread via the worker, refreshes `uiStore.gen`. Mounted
 * once at the app root. Theorycraft swaps the pool to the whole spell DB on a single
 * idealized chassis with NO caps (unlimited); otherwise it builds on ALL the player's
 * OWNED wands (every carried chassis) from the OWNED multiset — pool + per-spell caps
 * both derive from `ownedCounts` so a build never uses more copies than are held.
 * Stale results are dropped by reqId in the worker client + the store.
 */
export function useGeneration(): void {
  const wands = useRunStore((s) => s.wands)
  const bag = useRunStore((s) => s.spellInventory)
  const perks = useRunStore((s) => s.perks)
  const theorycraft = useUiStore((s) => s.theorycraft)
  const constraints = useUiStore((s) => s.constraints)

  useEffect(() => {
    // Owned mode builds on every carried wand; theorycraft builds on one ideal chassis.
    const chassis = theorycraft ? [IDEAL_CHASSIS] : ownedChassis(wands)
    // Owned mode: the pool IS the owned multiset (distinct ids + their caps). The
    // cumulative seen-this-run ledger is intentionally NOT the pool here — you can
    // only build with what you currently hold (owned-only v1; shop/pedestal = Phase 2).
    const counts = theorycraft ? undefined : ownedCounts(wands, bag)
    const poolIds = theorycraft ? [...spellDb.keys()] : [...counts!.keys()]
    if (poolIds.length === 0) {
      uiStore.getState().genReset()
      return
    }
    // Debounce bursts of snapshot/constraint changes (~250ms file-watch cadence).
    const handle = setTimeout(() => {
      const reqId = requestGenerate(
        { pool: poolIds, counts: counts ? [...counts] : undefined, chassis, perks: [...perks], constraints, theorycraft },
        (result) => uiStore.getState().genReady(reqId, result),
        (message) => uiStore.getState().genError(reqId, message),
      )
      uiStore.getState().genStart(reqId)
    }, 250)
    return () => clearTimeout(handle)
  }, [wands, bag, perks, theorycraft, constraints])
}
