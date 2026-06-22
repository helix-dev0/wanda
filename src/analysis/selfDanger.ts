// M4-T2 — self-danger evaluator: does this wand hurt the player, given their perks?
//
// A FIRST-CLASS VETO (spec §6.5), not a soft penalty. Two reliably-detected
// lethal hazards — point-blank FIRE and explosion-IN-FACE — mark a wand `unsafe`
// (the tier list banishes it to a separate Unsafe band). TOXIC and RECOIL are
// warn-only chips: their detection is weak (no toxic damage-type signal exists;
// recoil rarely kills), so they never veto.
//
// No spawn position exists in the cast result, so "in your face" is inferred
// geometrically: a projectile's reach (speedMax × lifetime) vs its blast radius —
// if the blast reaches back farther than the projectile flies, it catches you.
// The game's own `is_dangerous_blast` flag (6 point-blank alchemy spells) is a
// precise anchor on top. Explosions are only hazards when they DEAL damage
// (explosionDamage>0) — harmless digging explosions (digger) are excluded.
//
// Perk-relative: an immunity (or a projectile-repulsion/eater perk) neutralizes
// the matching hazard. Perks are EMPTY in every fixture (read deferred to M1),
// so this is unit-tested with SYNTHETIC perks only — never validated end-to-end.

import type { Wand, PerkRef } from '../schema/snapshot'
import type { WandShot } from '../engine/eval/types'
import { getSpell } from '../data/spellDb'
import { getProjectileStats, type ProjectileStats } from '../sim/data/projectileStats'
import {
  activeImmunities,
  hasSelfProjectileNeutralizer,
  perksGrantingImmunity,
} from './features/perkEffects'

export type Hazard = 'FIRE' | 'EXPLOSION' | 'TOXIC' | 'RECOIL'

export interface HazardFinding {
  hazard: Hazard
  severity: 'warn' | 'danger'
  /** Spell id (or 'recoil') that produces the hazard. */
  source: string
  /** Perk id that would neutralize it — present only when the player lacks the fix. */
  fixedBy?: string
}

export interface SelfDangerReport {
  findings: HazardFinding[]
  /** True iff an un-neutralized danger-severity hazard remains (→ Unsafe band). */
  unsafe: boolean
  /** Distinct perks that would clear the remaining hazards. */
  fixableByPerk: string[]
}

/** Point-blank fire streams/fields that burn the player at their own position. */
const CLOSE_FIRE: ReadonlySet<string> = new Set(['FLAMETHROWER'])

/** Spells that leak self-harmful materials (acid/lava/poison). Warn-only — no
 *  toxic damage-type signal exists in the projectile table, so this is curated. */
const CURATED_TOXIC: ReadonlySet<string> = new Set([
  'POISON_BLAST',
  'ACIDSHOT',
  'CIRCLE_ACID',
  'MATERIAL_ACID',
  'SEA_ACID',
  'SEA_ACID_GAS',
  'SEA_LAVA',
  'BLOOD_TO_ACID',
  'TOXIC_TO_ACID',
])

/** Recoil magnitude that earns a warn. The engine DOES populate castState.recoil
 *  (a couple of actions mutate it), but the right threshold is uncalibrated, so
 *  this stays deliberately conservative — PROVISIONAL. */
const RECOIL_WARN = 50

/** Distance a projectile travels before it dies (px). 0 = stationary (detonates
 *  at the cast point ≈ the player); Infinity = endless (flies away, never back). */
function reachOf(st: ProjectileStats): number {
  if (st.lifetime < 0) return Infinity
  if (st.speedMax === 0) return 0
  return (st.speedMax * st.lifetime) / 60
}

function isBlast(sourceId: string, cs: WandShot['castState']): boolean {
  return cs?.action_is_dangerous_blast === true || getSpell(sourceId)?.is_dangerous_blast === true
}

/** Evaluate one wand's self-danger relative to the player's acquired perks. */
export function evaluateSelfDanger(
  wand: Wand,
  shots: readonly WandShot[],
  perks: readonly PerkRef[],
): SelfDangerReport {
  let fireSource: string | null = null
  let firePointBlank = false
  let explosionSource: string | null = null
  let maxRecoil = 0

  for (const shot of shots) {
    const cs = shot.castState
    const fireAdd = cs?.damage_fire_add ?? 0
    const explAdd = cs?.damage_explosion_add ?? 0
    const radiusAdd = cs?.explosion_radius ?? 0
    maxRecoil = Math.max(maxRecoil, cs?.recoil ?? 0)

    for (const p of shot.projectiles) {
      const sourceId = p.action?.id ?? p.entity
      const st = getProjectileStats(p.entity)

      // FIRE — any fire damage on the projectile, or a fire-adding modifier.
      if ((st?.damageByType?.fire ?? 0) > 0 || fireAdd > 0) {
        fireSource ??= sourceId
        const pointBlank =
          isBlast(sourceId, cs) || CLOSE_FIRE.has(sourceId) || (st != null && st.speedMax === 0)
        if (pointBlank) firePointBlank = true
      }

      // EXPLOSION-in-face — a DAMAGING explosion whose blast reaches back to you.
      if (st) {
        const explDmg = st.explosionDamage + explAdd
        const explRadius = st.explosionRadius + radiusAdd
        if (explDmg > 0 && (isBlast(sourceId, cs) || explRadius >= reachOf(st))) {
          explosionSource ??= sourceId
        }
      }
    }
  }

  // TOXIC — curated material spells anywhere in the deck or the cast.
  const deckIds = new Set<string>([
    ...wand.spells.filter((s): s is string => s !== null),
    ...wand.always_cast,
  ])
  const toxicSource = [...deckIds].find((id) => CURATED_TOXIC.has(id)) ?? null

  // Assemble raw findings (pre-neutralization).
  const raw: HazardFinding[] = []
  if (fireSource) {
    raw.push({ hazard: 'FIRE', severity: firePointBlank ? 'danger' : 'warn', source: fireSource })
  }
  if (explosionSource) {
    raw.push({ hazard: 'EXPLOSION', severity: 'danger', source: explosionSource })
  }
  if (toxicSource) raw.push({ hazard: 'TOXIC', severity: 'warn', source: toxicSource })
  if (maxRecoil >= RECOIL_WARN) raw.push({ hazard: 'RECOIL', severity: 'warn', source: 'recoil' })

  // Neutralize against perks: immunities + self-projectile repulsion drop a hazard.
  const immun = activeImmunities(perks)
  const repel = hasSelfProjectileNeutralizer(perks)
  const findings: HazardFinding[] = []
  for (const f of raw) {
    if (isNeutralized(f.hazard, immun, repel)) continue
    findings.push({ ...f, fixedBy: fixPerkFor(f.hazard) })
  }

  const unsafe = findings.some((f) => f.severity === 'danger')
  const fixableByPerk = [
    ...new Set(findings.map((f) => f.fixedBy).filter((id): id is string => id != null)),
  ]
  return { findings, unsafe, fixableByPerk }
}

function isNeutralized(h: Hazard, immun: ReturnType<typeof activeImmunities>, repel: boolean): boolean {
  switch (h) {
    case 'FIRE':
      return immun.has('FIRE') || repel
    case 'EXPLOSION':
      return immun.has('EXPLOSION') || repel
    case 'TOXIC':
      return immun.has('TOXIC') || immun.has('RADIOACTIVE') || repel
    case 'RECOIL':
      return false // physics, not a damage type — no immunity neutralizes it
  }
}

function fixPerkFor(h: Hazard): string | undefined {
  switch (h) {
    case 'FIRE':
      return perksGrantingImmunity('FIRE')[0]
    case 'EXPLOSION':
      return perksGrantingImmunity('EXPLOSION')[0]
    case 'TOXIC':
      return perksGrantingImmunity('TOXIC')[0]
    case 'RECOIL':
      return undefined
  }
}
