// M5 — generation web worker (THIN). Runs the bounded, pure generate() OFF the UI
// thread (spec §6.4: "push heavy search off the UI thread"). All logic is in
// generate.ts; this only marshals messages. It is a separate module instance, so
// it has its OWN sim cache + engineConfig — cleared per request to bound memory and
// the per-archetype candidate budget. NOT unit-tested (no worker env in node) —
// covered by the T4 browser run. NEVER import this file from a test: `self` is
// undefined under node.

import { generate } from './generate'
import { clearSimCache } from '../analysis/simCache'
import type { GenRequestMsg, WorkerResponse } from './types'

// Minimal worker-scope shape — sidesteps a webworker/DOM lib clash on `self`
// (the app tsconfig uses the DOM lib, where self is a Window).
interface WorkerScope {
  onmessage: ((e: MessageEvent<GenRequestMsg>) => void) | null
  postMessage(message: WorkerResponse): void
}
const ctx = self as unknown as WorkerScope

ctx.onmessage = (e) => {
  const msg = e.data
  if (msg?.type !== 'generate') return
  try {
    clearSimCache() // fresh per request: bounds memory + the per-archetype budget
    const result = generate({
      pool: msg.pool,
      chassis: msg.chassis,
      perks: msg.perks,
      constraints: msg.constraints,
      counts: msg.counts, // forward owned caps — the worker lists each field, no spread
      archetypes: msg.archetypes,
    })
    ctx.postMessage({ type: 'result', reqId: msg.reqId, result })
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      reqId: msg.reqId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
