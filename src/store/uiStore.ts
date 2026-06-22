import { createStore } from 'zustand/vanilla'
import type { Constraints, GenerateResult } from '../generation/types'

/**
 * UI store — the guidance dial + generation state (M5-T3). Mirrors runStore's
 * vanilla-store pattern (factory + singleton, no React import here) so the
 * transitions are Node-testable. The dial is a PRESENTATION layer (spec §6.5): it
 * holds only how much to reveal (rung / drilled cards) and the generation inputs
 * (theorycraft / constraints) + the worker's latest result — never a second engine.
 */

/** The four guidance rungs (spec §6.5). Default is the assistant-level Suggest. */
export type Rung = 'mirror' | 'teach' | 'suggest' | 'prescribe'
export const RUNGS: readonly Rung[] = ['mirror', 'teach', 'suggest', 'prescribe']

export type GenStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface GenState {
  readonly status: GenStatus
  /** reqId of the latest request; results for older ids are dropped. */
  readonly reqId: number
  readonly builds: GenerateResult | null
  readonly error: string | null
}

export interface UiStateData {
  readonly rung: Rung
  /** wandKeys of cards drilled to fullest (Prescribe) detail inline. */
  readonly drilled: ReadonlySet<string>
  /** Theorycraft mode: generate from the whole spell DB, not just the owned+seen pool. */
  readonly theorycraft: boolean
  readonly constraints: Constraints
  readonly gen: GenState
}

export interface UiStateActions {
  setRung: (rung: Rung) => void
  /** Expand/collapse one card's drill-down (per-card override of the global rung). */
  toggleDrill: (key: string) => void
  setTheorycraft: (on: boolean) => void
  setConstraints: (c: Constraints) => void
  genStart: (reqId: number) => void
  genReady: (reqId: number, builds: GenerateResult) => void
  genError: (reqId: number, message: string) => void
  /** Clear results to idle (e.g. the pool emptied / run reset). */
  genReset: () => void
}

export type UiStore = UiStateData & UiStateActions

/** A fresh, fully-default UI state (no shared mutable references). */
export function freshUiState(): UiStateData {
  return {
    rung: 'suggest', // assistant/guide by default; Prescribe is opt-in (spec §6.5)
    drilled: new Set(),
    theorycraft: false,
    constraints: {},
    gen: { status: 'idle', reqId: 0, builds: null, error: null },
  }
}

/** Create an isolated UI store (one per app; factory enables clean tests). */
export function createUiStore() {
  return createStore<UiStore>()((set) => ({
    ...freshUiState(),
    setRung: (rung) => set({ rung }),
    toggleDrill: (key) =>
      set((s) => {
        const drilled = new Set(s.drilled)
        if (drilled.has(key)) drilled.delete(key)
        else drilled.add(key)
        return { drilled }
      }),
    setTheorycraft: (theorycraft) => set({ theorycraft }),
    setConstraints: (constraints) => set({ constraints }),
    genStart: (reqId) => set((s) => ({ gen: { ...s.gen, status: 'loading', reqId, error: null } })),
    genReady: (reqId, builds) =>
      set((s) =>
        reqId === s.gen.reqId ? { gen: { ...s.gen, status: 'ready', builds, error: null } } : s,
      ),
    genError: (reqId, message) =>
      set((s) => (reqId === s.gen.reqId ? { gen: { ...s.gen, status: 'error', error: message } } : s)),
    genReset: () => set((s) => ({ gen: { status: 'idle', reqId: s.gen.reqId, builds: null, error: null } })),
  }))
}

export type UiStoreApi = ReturnType<typeof createUiStore>

/** The app-wide UI store. The UI binds to it via `useUiStore` (M5-T4). */
export const uiStore = createUiStore()
