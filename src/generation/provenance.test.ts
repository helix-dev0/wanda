import { describe, it, expect } from 'vitest'
import { labelForSpell, buildProvenance } from './provenance'
import type { ProvenanceEntry } from '../store/runStore'

const entry = (over: Partial<ProvenanceEntry>): ProvenanceEntry => ({
  origin: 'owned',
  origins: ['owned'],
  fresh: true,
  firstSeen: 0,
  lastSeen: 0,
  ...over,
})

describe('labelForSpell — "go grab X" from ledger provenance', () => {
  it('owned + fresh → your bag', () => {
    const p = new Map([['X', entry({ origin: 'owned', fresh: true })]])
    expect(labelForSpell('X', p)).toEqual({ text: 'your bag', kind: 'owned' })
  })

  it('shop + fresh → shop', () => {
    const p = new Map([['X', entry({ origin: 'shop', origins: ['shop'], fresh: true })]])
    expect(labelForSpell('X', p)).toEqual({ text: 'shop', kind: 'shop' })
  })

  it('pedestal + fresh → pedestal', () => {
    const p = new Map([['X', entry({ origin: 'pedestal', origins: ['pedestal'], fresh: true })]])
    expect(labelForSpell('X', p)).toEqual({ text: 'pedestal', kind: 'pedestal' })
  })

  it('not on screen now → seen earlier (regardless of origin)', () => {
    const p = new Map([['X', entry({ origin: 'shop', origins: ['shop'], fresh: false })]])
    expect(labelForSpell('X', p)).toEqual({ text: 'seen earlier', kind: 'stale' })
  })

  it('absent from the pool → theorycraft (full-DB mode; you do not have it)', () => {
    expect(labelForSpell('X', new Map())).toEqual({ text: 'theorycraft', kind: 'unknown' })
  })
})

describe('buildProvenance — per-slot labels for a build deck', () => {
  it('labels each spell and passes empty slots through as null', () => {
    const p = new Map([
      ['A', entry({ origin: 'owned', fresh: true })],
      ['B', entry({ origin: 'shop', origins: ['shop'], fresh: false })],
    ])
    expect(buildProvenance(['A', null, 'B'], p)).toEqual([
      { text: 'your bag', kind: 'owned' },
      null,
      { text: 'seen earlier', kind: 'stale' },
    ])
  })
})
