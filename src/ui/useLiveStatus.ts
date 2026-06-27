import { useStore } from 'zustand'
import { liveStatusStore, type LiveStatusStore } from '../store/liveStatusStore'

/** Bind the app-wide live-status store into React with a typed selector (zustand v5
 *  vanilla-store pattern, mirroring useRunStore). The store stays framework-agnostic
 *  and Node-testable; this is the only React-aware seam. */
export function useLiveStatus<T>(selector: (state: LiveStatusStore) => T): T {
  return useStore(liveStatusStore, selector)
}
