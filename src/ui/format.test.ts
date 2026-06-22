import { describe, it, expect } from 'vitest'
import {
  framesToSeconds,
  formatFrames,
  formatSpread,
  formatMana,
} from './format'

/**
 * Real fixture values drive these assertions:
 *  - snapshot_01.json wand: castDelay 13, rechargeTime 28, mana 83.
 *  - snapshot_03.json wand: rechargeTime 40, spread -3, mana 390.
 * Noita runs at 60 fps, so 60 frames = 1.0s.
 */

describe('framesToSeconds', () => {
  it('divides frames by 60 (Noita is 60 fps)', () => {
    expect(framesToSeconds(60)).toBe(1)
    expect(framesToSeconds(30)).toBe(0.5)
  })

  it('handles the real fixture cast delay (13 frames)', () => {
    expect(framesToSeconds(13)).toBeCloseTo(0.21667, 5)
  })

  it('returns 0 for 0 frames', () => {
    expect(framesToSeconds(0)).toBe(0)
  })
})

describe('formatFrames', () => {
  it('formats real fixture timings to 2 decimals + "s"', () => {
    expect(formatFrames(13)).toBe('0.22s') // snapshot_01 castDelay
    expect(formatFrames(28)).toBe('0.47s') // snapshot_01 rechargeTime
    expect(formatFrames(40)).toBe('0.67s') // snapshot_03 rechargeTime
  })

  it('formats 0 frames as "0.00s"', () => {
    expect(formatFrames(0)).toBe('0.00s')
  })

  it('formats a whole second cleanly', () => {
    expect(formatFrames(60)).toBe('1.00s')
  })

  it('collapses a value that ROUNDS to negative zero (no stray "-0.00s")', () => {
    expect(formatFrames(-0.1)).toBe('0.00s')
  })
})

describe('formatSpread', () => {
  it('formats positive degrees to 1 decimal + "°"', () => {
    expect(formatSpread(4)).toBe('4.0°')
  })

  it('formats negative spread (real: snapshot_03 spread -3)', () => {
    expect(formatSpread(-3)).toBe('-3.0°')
  })

  it('formats 0 as "0.0°"', () => {
    expect(formatSpread(0)).toBe('0.0°')
  })

  it('keeps one decimal of precision', () => {
    expect(formatSpread(-13.24)).toBe('-13.2°')
  })

  it('collapses a value that ROUNDS to negative zero (no stray "-0.0")', () => {
    expect(formatSpread(-0.04)).toBe('0.0°')
  })
})

describe('formatMana', () => {
  it('renders the real fixture mana values as integers', () => {
    expect(formatMana(83)).toBe('83') // snapshot_01
    expect(formatMana(390)).toBe('390') // snapshot_03
  })

  it('rounds to the nearest integer', () => {
    expect(formatMana(82.6)).toBe('83')
    expect(formatMana(82.4)).toBe('82')
  })

  it('renders 0', () => {
    expect(formatMana(0)).toBe('0')
  })
})
