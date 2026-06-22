import { describe, it, expect } from 'vitest'
import { tr, spellTooltipData, perkTooltipData } from './loc'

describe('loc — resolve real game names + descriptions from loc keys', () => {
  it('tr resolves a $loc key (and bare key) to translated text', () => {
    expect(tr('$action_rubber_ball')).toBe('Bouncing burst')
    expect(tr('actiondesc_rubber_ball')).toBe('A very bouncy projectile')
    expect(tr('$not_a_real_key')).toBeUndefined()
    expect(tr(undefined)).toBeUndefined()
  })

  it('spellTooltipData gives the real name, description, and type', () => {
    const d = spellTooltipData('RUBBER_BALL')
    expect(d.name).toBe('Bouncing burst')
    expect(d.description).toBe('A very bouncy projectile')
    expect(d.typeName).toBe('PROJECTILE')
  })

  it('spellTooltipData includes mana from the DB', () => {
    expect(spellTooltipData('LIGHT_BULLET').meta).toContainEqual({ label: 'Mana', value: '5' })
  })

  it('perkTooltipData gives the real perk name + description', () => {
    const d = perkTooltipData('CRITICAL_HIT')
    expect(d.name).toBe('Critical Hit +')
    expect(d.description).toBe('You get more critical hits')
  })

  it('falls back to the prettified id for unknown ids (never throws)', () => {
    expect(spellTooltipData('TOTALLY_FAKE').name).toBe('Totally Fake')
    expect(perkTooltipData('TOTALLY_FAKE').name).toBe('Totally Fake')
  })
})
