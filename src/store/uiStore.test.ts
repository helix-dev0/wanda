import { describe, it, expect } from 'vitest'
import { createUiStore, freshUiState } from './uiStore'
import type { GenerateResult } from '../generation/types'

const noBuilds = {} as GenerateResult // status transitions don't inspect build content

describe('uiStore — dial state', () => {
  it('defaults to the Suggest rung (assistant default, Prescribe opt-in)', () => {
    expect(freshUiState().rung).toBe('suggest')
    expect(createUiStore().getState().rung).toBe('suggest')
  })

  it('setRung changes the global rung', () => {
    const s = createUiStore()
    s.getState().setRung('prescribe')
    expect(s.getState().rung).toBe('prescribe')
  })

  it('toggleDrill expands then collapses a single card (per-card override)', () => {
    const s = createUiStore()
    s.getState().toggleDrill('w1')
    expect(s.getState().drilled.has('w1')).toBe(true)
    s.getState().toggleDrill('w1')
    expect(s.getState().drilled.has('w1')).toBe(false)
  })

  it('tracks theorycraft + constraints', () => {
    const s = createUiStore()
    s.getState().setTheorycraft(true)
    s.getState().setConstraints({ mustDig: true, noSelfDamage: true })
    expect(s.getState().theorycraft).toBe(true)
    expect(s.getState().constraints).toEqual({ mustDig: true, noSelfDamage: true })
  })
})

describe('uiStore — generation lifecycle', () => {
  it('drives idle → loading → ready', () => {
    const s = createUiStore()
    expect(s.getState().gen.status).toBe('idle')
    s.getState().genStart(1)
    expect(s.getState().gen.status).toBe('loading')
    expect(s.getState().gen.reqId).toBe(1)
    s.getState().genReady(1, noBuilds)
    expect(s.getState().gen.status).toBe('ready')
    expect(s.getState().gen.builds).toBe(noBuilds)
  })

  it('drops a stale result whose reqId is not the current request', () => {
    const s = createUiStore()
    s.getState().genStart(2)
    s.getState().genReady(1, noBuilds) // older request resolves late → ignored
    expect(s.getState().gen.status).toBe('loading')
    s.getState().genReady(2, noBuilds)
    expect(s.getState().gen.status).toBe('ready')
  })

  it('records an error for the current request', () => {
    const s = createUiStore()
    s.getState().genStart(1)
    s.getState().genError(1, 'boom')
    expect(s.getState().gen.status).toBe('error')
    expect(s.getState().gen.error).toBe('boom')
  })

  it('genReset clears builds back to idle', () => {
    const s = createUiStore()
    s.getState().genStart(1)
    s.getState().genReady(1, noBuilds)
    s.getState().genReset()
    expect(s.getState().gen.status).toBe('idle')
    expect(s.getState().gen.builds).toBeNull()
  })
})
