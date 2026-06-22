import type { Wand } from '../schema/snapshot'
import { spellDisplayName, spellTypeName, getSpell } from '../data/spellDb'
import { formatFrames, formatSpread, formatMana } from './format'

/**
 * Presentational view-model for the wand panel (M2-T3). Pure functions only — no
 * React, no DOM — so the values shown are unit-tested in node; components stay
 * thin and are verified by rendering in a real browser.
 */

/** Noita colors spell cards by action type. Map the type name → a CSS class
 *  suffix used by `.spell-tile.<suffix>` in the theme. */
export const SPELL_TYPE_CLASS: Record<string, string> = {
  PROJECTILE: 'projectile',
  STATIC_PROJECTILE: 'static',
  MODIFIER: 'modifier',
  DRAW_MANY: 'multicast',
  MATERIAL: 'material',
  OTHER: 'other',
  UTILITY: 'utility',
  PASSIVE: 'passive',
}

export interface SpellTileModel {
  empty: boolean
  id: string | null
  name: string
  typeName: string | null
  /** CSS class suffix: a type key, `'empty'` (no spell), or `'unknown'` (modded). */
  typeClass: string
  mana: number | null
  alwaysCast: boolean
}

/** Build the view-model for one deck slot. `id === null` is an empty slot. */
export function spellTile(id: string | null, opts: { alwaysCast?: boolean } = {}): SpellTileModel {
  const alwaysCast = opts.alwaysCast ?? false
  if (id === null) {
    return {
      empty: true,
      id: null,
      name: '',
      typeName: null,
      typeClass: 'empty',
      mana: null,
      alwaysCast,
    }
  }
  const typeName = spellTypeName(id) ?? null
  return {
    empty: false,
    id,
    name: spellDisplayName(id),
    typeName,
    typeClass: (typeName && SPELL_TYPE_CLASS[typeName]) || 'unknown',
    mana: getSpell(id)?.mana ?? null,
    alwaysCast,
  }
}

export interface StatRow {
  key: string
  label: string
  value: string
}

/** Wand stats as labeled, formatted rows, in a stable display order. */
export function wandStatRows(wand: Wand): StatRow[] {
  const s = wand.stats
  return [
    { key: 'shuffle', label: 'Shuffle', value: s.shuffle ? 'Yes' : 'No' },
    { key: 'spellsPerCast', label: 'Spells / Cast', value: String(s.spellsPerCast) },
    { key: 'castDelay', label: 'Cast Delay', value: formatFrames(s.castDelay) },
    { key: 'rechargeTime', label: 'Recharge', value: formatFrames(s.rechargeTime) },
    { key: 'mana', label: 'Mana', value: `${formatMana(s.mana)}/${formatMana(s.manaMax)}` },
    { key: 'manaChargeSpeed', label: 'Mana Charge', value: `${formatMana(s.manaChargeSpeed)}/s` },
    { key: 'capacity', label: 'Capacity', value: String(s.capacity) },
    { key: 'spread', label: 'Spread', value: formatSpread(s.spread) },
    { key: 'speedMultiplier', label: 'Cast Speed', value: `×${s.speedMultiplier.toFixed(2)}` },
  ]
}
