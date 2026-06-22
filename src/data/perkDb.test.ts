import { describe, it, expect } from 'vitest'
import { perkDb, getPerk, perkDisplayName, perkSpriteSrc } from './perkDb'

// M2: read-only perk-DB lookup over the recorded perk_db.json fixture.
// Fixture-driven (no live game); asserts a known perk resolves and unknown ids
// are handled safely without throwing.

describe('perkDb lookup module', () => {
  it('indexes every perk by id (>100 entries)', () => {
    expect(perkDb.size).toBeGreaterThan(100)
  })

  it('getPerk returns the entry for a known id', () => {
    const crit = getPerk('CRITICAL_HIT')
    expect(crit).toBeDefined()
    expect(crit?.id).toBe('CRITICAL_HIT')
    expect(crit?.ui_name).toBe('$perk_critical_hit')
  })

  it('getPerk returns undefined for an unknown id', () => {
    expect(getPerk('NOT_A_REAL_PERK')).toBeUndefined()
  })

  it('perkDisplayName prettifies the id (self-contained, no loc key)', () => {
    expect(perkDisplayName('CRITICAL_HIT')).toBe('Critical Hit')
    expect(perkDisplayName('PROTECTION_FIRE')).toBe('Protection Fire')
    expect(perkDisplayName('EXTRA_MONEY')).toBe('Extra Money')
  })

  it('perkDisplayName falls back to the prettified id for an unknown perk (never throws)', () => {
    expect(perkDisplayName('SOME_UNKNOWN_PERK')).toBe('Some Unknown Perk')
  })

  it('perkSpriteSrc returns the bundled icon as a data URL (offline-extracted)', () => {
    expect(perkSpriteSrc('CRITICAL_HIT')).toMatch(/^data:image\/png;base64,/)
  })

  it('perkSpriteSrc is null for an unknown perk', () => {
    expect(perkSpriteSrc('NOT_A_REAL_PERK')).toBeNull()
  })
})
