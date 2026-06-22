import { useStore } from 'zustand'
import { uiStore, type UiStore } from '../store/uiStore'

/** Bind the app-wide vanilla UI store into React with a typed selector (zustand v5
 *  vanilla-store pattern), mirroring useRunStore. The store stays Node-testable;
 *  this is the only React-aware seam. */
export function useUiStore<T>(selector: (state: UiStore) => T): T {
  return useStore(uiStore, selector)
}
