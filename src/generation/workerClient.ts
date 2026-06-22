// M5 — main-thread handle to the generation worker. A lazy singleton (one worker
// reused across requests) with reqId bookkeeping: only the LATEST request's
// callbacks are retained, so a burst of snapshot/constraint changes delivers just
// the final result and stale results are dropped. NOT unit-tested (no worker in
// node); the worker round-trip is covered by the T4 browser run.

import type { GenerateRequest, GenerateResult, GenRequestMsg, WorkerResponse } from './types'

let worker: Worker | null = null
let nextReqId = 1
let pending: {
  reqId: number
  onResult: (r: GenerateResult) => void
  onError: (m: string) => void
} | null = null

function getWorker(): Worker {
  if (worker) return worker
  // Vite module-worker form — the new URL() MUST be inline in the new Worker() call
  // and the options static for Vite's worker detection (verified, Vite v8.0.10 docs).
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data
    if (!pending || msg.reqId !== pending.reqId) return // stale request — dropped
    const { onResult, onError } = pending
    pending = null
    if (msg.type === 'result') onResult(msg.result)
    else onError(msg.message)
  }
  return worker
}

/**
 * Post a generation request to the worker; returns its reqId. Supersedes any
 * in-flight request (the superseded request's callbacks will not fire).
 */
export function requestGenerate(
  req: GenerateRequest,
  onResult: (r: GenerateResult) => void,
  onError: (m: string) => void,
): number {
  const reqId = nextReqId++
  pending = { reqId, onResult, onError }
  const msg: GenRequestMsg = { type: 'generate', reqId, ...req }
  getWorker().postMessage(msg)
  return reqId
}
