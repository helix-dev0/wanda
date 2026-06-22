/**
 * Display formatters for the wand-stat panel (M2-T3).
 *
 * Pure, numeric/timing/stat formatting only — no React, no DOM, no side
 * effects. Each takes a raw stat value (the units EZWand emits, per
 * `src/schema/snapshot.ts` `WandStats`) and returns a UI-ready string.
 *
 * Units (verified against the schema doc-comments, not recalled):
 *  - `castDelay` / `rechargeTime` are in FRAMES; Noita runs at 60 fps, so
 *    60 frames = 1.0s.
 *  - `spread` is in DEGREES and may be negative (e.g. -13.2).
 *  - `mana` / `manaMax` / `capacity` / etc. are plain numbers.
 *
 * Spell-name / action-id prettifying is intentionally NOT here — that belongs
 * to a separate module.
 */

/** Fixed-decimal format that collapses a value ROUNDING to negative zero back to
 *  positive zero — `(-0.04).toFixed(1)` is "-0.0", a stray sign in the UI. The
 *  guard must run AFTER toFixed, since the artifact appears during rounding. */
function fixed(n: number, dp: number): string {
  const s = n.toFixed(dp)
  const zero = (0).toFixed(dp)
  return s === `-${zero}` ? zero : s
}

/** Convert a frame count to seconds. Noita runs at 60 fps, so 60 → 1.0. */
export function framesToSeconds(frames: number): number {
  return frames / 60
}

/** Frame count as a seconds duration: 2 decimals + "s" (e.g. 13 → "0.22s"). */
export function formatFrames(frames: number): string {
  return `${fixed(framesToSeconds(frames), 2)}s`
}

/** Spread in degrees: 1 decimal + "°" (e.g. -3 → "-3.0°", may be negative). */
export function formatSpread(deg: number): string {
  return `${fixed(deg, 1)}°`
}

/** Mana (or any whole-number stat) rounded to an integer string (e.g. 390). */
export function formatMana(n: number): string {
  const r = Math.round(n)
  return String(r === 0 ? 0 : r) // collapse -0 → 0
}
