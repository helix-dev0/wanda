import { useEffect } from 'react'
import { uiStore } from '../store/uiStore'
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

/**
 * Debounced generation driver (M5-T3). Watches the pool / held wand / perks / dial
 * inputs and, off the UI thread via the worker, refreshes `uiStore.gen`. Mounted
 * once at the app root. Theorycraft swaps the pool to the whole spell DB and builds
 * on an idealized chassis; otherwise it improves the held wand from the owned+seen
 * pool. Stale results are dropped by reqId in the worker client + the store.
 */
export function useGeneration(): void {
  const pool = useRunStore((s) => s.ledger.spells)
  const wands = useRunStore((s) => s.wands)
  const perks = useRunStore((s) => s.perks)
  const theorycraft = useUiStore((s) => s.theorycraft)
  const constraints = useUiStore((s) => s.constraints)

  useEffect(() => {
    const held = activeWand(wands)
    const chassis = theorycraft ? IDEAL_CHASSIS : (held ?? IDEAL_CHASSIS)
    const poolIds = theorycraft ? [...spellDb.keys()] : [...pool]
    if (poolIds.length === 0) {
      uiStore.getState().genReset()
      return
    }
    // Debounce bursts of snapshot/constraint changes (~250ms file-watch cadence).
    const handle = setTimeout(() => {
      const reqId = requestGenerate(
        { pool: poolIds, chassis, perks: [...perks], constraints },
        (result) => uiStore.getState().genReady(reqId, result),
        (message) => uiStore.getState().genError(reqId, message),
      )
      uiStore.getState().genStart(reqId)
    }, 250)
    return () => clearTimeout(handle)
  }, [pool, wands, perks, theorycraft, constraints])
}
