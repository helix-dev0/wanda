import type { Wand } from '../schema/snapshot'
import type { SpellDbEntry } from '../schema/spell-db'
import { spellDisplayName, spellTypeName, getSpell } from '../data/spellDb'
import { formatFrames, formatSpread, formatMana } from './format'

/**
 * Presentational view-model for the wand panel (M2-T3/T4). Pure functions only —
 * no React, no DOM — so the values shown are unit-tested in node; components stay
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

/**
 * Resolve a renderable image source for a spell's real game icon, or null to
 * fall back to the type-coloured text tile.
 *
 * Real icons come "from the actual run": the extraction mod exports each spell's
 * sprite PNG (the DB entry only carries a game-internal `sprite` PATH like
 * `data/ui_gfx/gun_actions/rubber_ball.png`, whose bytes live packed in the
 * game's data.wak — not loadable in a browser). The agreed transport is a
 * base64 `sprite_base64` field added to the DB dump at M1; the spell-DB schema is
 * a looseObject, so that field round-trips today without a schema change, and
 * this resolver lights up the instant a sprite-carrying DB is captured. Until
 * then it returns null and the tile shows text.
 */
export function resolveSpriteSrc(entry: SpellDbEntry | undefined): string | null {
  if (!entry) return null
  const b64 = (entry as Record<string, unknown>).sprite_base64
  return typeof b64 === 'string' && b64.length > 0 ? `data:image/png;base64,${b64}` : null
}

/**
 * Resolve a renderable image source for a WAND's real game icon, or null to fall
 * back to the text label. Mirrors {@link resolveSpriteSrc}: the bytes ride a base64
 * `sprite_base64` field on the wand. Unlike spells, wand sprites are procedurally
 * composed from parts (not a single packed PNG), so they are NOT extracted offline —
 * the field is populated later by the extraction mod (human-in-the-loop), at which
 * point this resolver lights up with no UI change. Until then it returns null and the
 * chassis is identified by its text label ("rebuild your slot-2 wand · cap 19").
 */
export function resolveWandSpriteSrc(wand: Wand): string | null {
  const b64 = (wand as Record<string, unknown>).sprite_base64
  return typeof b64 === 'string' && b64.length > 0 ? `data:image/png;base64,${b64}` : null
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
  /** Charges left for a bag spell; null = unlimited or not a bag spell. */
  usesRemaining: number | null
  /** Real game icon as a data URL when available (see resolveSpriteSrc), else null. */
  spriteSrc: string | null
}

export interface SpellTileOpts {
  alwaysCast?: boolean
  usesRemaining?: number | null
}

/** Build the view-model for one spell slot/card. A null or empty id is an empty slot. */
export function spellTile(id: string | null, opts: SpellTileOpts = {}): SpellTileModel {
  const alwaysCast = opts.alwaysCast ?? false
  if (!id) {
    return {
      empty: true,
      id: null,
      name: '',
      typeName: null,
      typeClass: 'empty',
      mana: null,
      alwaysCast,
      usesRemaining: null,
      spriteSrc: null,
    }
  }
  const entry = getSpell(id)
  const typeName = spellTypeName(id) ?? null
  return {
    empty: false,
    id,
    name: spellDisplayName(id),
    typeName,
    typeClass: (typeName && SPELL_TYPE_CLASS[typeName]) || 'unknown',
    mana: entry?.mana ?? null,
    alwaysCast,
    usesRemaining: opts.usesRemaining ?? null,
    spriteSrc: resolveSpriteSrc(entry),
  }
}

/** The held/active wand: the one flagged `active`, else (older snapshots with no
 *  flag) the slot-0 wand, else the first. Single source of truth for "held" so the
 *  panel title, tier-list primary, and generation chassis all agree. */
export function activeWand(wands: readonly Wand[]): Wand | undefined {
  return wands.find((w) => w.active) ?? wands.find((w) => w.slot === 0) ?? wands[0]
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
