import { useStore } from 'zustand'
import { runStore, type RunStore } from '../store/runStore'

/** Bind the app-wide vanilla run-state store into React with a typed selector
 *  (zustand v5 vanilla-store pattern). The store itself stays framework-agnostic
 *  and Node-testable; this is the only React-aware seam. */
export function useRunStore<T>(selector: (state: RunStore) => T): T {
  return useStore(runStore, selector)
}
