// M3-T3b — derive interpretable metrics from a cast result.
//
// Everything here is computed from clickWand's output (WandShot[] + reloadTime)
// joined with the wand's snapshot stats and the projectile base-stats table.
// Damage is honestly APPROXIMATE: raw HP, neutral resistances, single-hit
// (pierce/bounce not multiplied). It now models: typed damage_by_type (B1),
// crit on ALL channels — projectile + explosion + AoE blast (B2), trigger
// payloads (recursive), mana-limited effective DPS (B4), and damage-weighted
// reach (B3). Velocity/speed damage remains DEFERRED (anti-proxy). See docs/
// scoring-rebuild-spec.md.

import type { WandShot } from '../engine/eval/types'
import type { WandStats } from '../schema/snapshot'
import { framesToSeconds } from '../ui/format'
import { getProjectileStats, DAMAGE_UNIT_HP, type ProjectileStats } from './data/projectileStats'

export interface WandMetrics {
  /** Shots fired before the deck reloads (lower bound when `truncated`). */
  shotsUntilReload: number
  /** Frames for one full fire-until-reload cycle (firing + reload). */
  cycleFrames: number
  cycleSeconds: number
  /** Firing portion only (excludes reload), seconds. */
  fireSeconds: number

  /** Top-level projectiles from the first cast (one click). */
  projectilesPerCast: number
  projectilesPerCycle: number
  projectilesPerSecond: number

  /** Expected HP from one click (raw, single-hit, no crit). */
  damagePerCast: number
  /** Expected HP across one full cycle. */
  damagePerCycle: number
  /** HP/sec including reload, at full mana (the raw cycle rate; ignores mana scarcity). */
  sustainedDps: number
  /** HP/sec the wand can SUSTAIN once mana is the bottleneck: `sustainedDps × min(1,
   *  regen/drain)`. Equals `sustainedDps` for any mana-sustainable wand; lower for one that
   *  out-drains its regen (it can only fire as often as it can pay for). The honest
   *  single-target headline the scorer reads. */
  effectiveSustainedDps: number
  /** HP/sec while actively firing, excluding reload (the burst/nova peak). */
  burstDps: number

  manaPerCycle: number
  manaSustainable: boolean
  /** Seconds of continuous fire before mana stalls; null = sustainable forever. */
  secondsUntilStall: number | null

  /** Wand base spread + the cast's accumulated spread (degrees; may be negative). */
  effectiveSpread: number
  /** Damage-weighted mean projectile reach (px) across the cycle — how far the wand's
   *  damage actually travels. Lets the scorer tell a ranged wand (light_bullet ~570px)
   *  from a close-range tool used as a "damage" wand (luminous drill ~47px, chainsaw
   *  ~7px). Endless projectiles count as full reach; 0 when the deck deals no damage. */
  reachWeightedPx: number
  /** Largest explosion radius produced in the cycle (px); 0 if none. */
  maxExplosionRadius: number
  /** Largest explosion DAMAGE produced in the cycle (HP); 0 if none. Separates a
   *  lethal blast from a harmless digging explosion (same radius, no damage). */
  maxExplosionDamage: number

  /** Status / damage-over-time the wand APPLIES — a capability flag, not a damage
   *  number. Poison/toxic are material-stain status (not a projectile damage field), so
   *  we can detect *that* a wand applies them but not quantify it from projectile data;
   *  all three DoTs tick ~2% max-HP/s in-game, which is the answer to tanky/boss targets
   *  a raw-HP single-hit model is blind to. Default all-false; surfaced for a boss/tank
   *  lens. (Grounded: noita.wiki.gg Fire / Toxic Sludge / Damage_types — see
   *  docs/scoring-grounding-spec.md Principle 8.) */
  appliesDot: { fire: boolean; poison: boolean; toxic: boolean }

  /** Engine hit its 10-iteration cap — cycle figures are a truncated lower bound. */
  truncated: boolean
  /** A fired projectile was absent from the stats table (modded) — damage understated. */
  damageApproximate: boolean
}

// Per-shot frame delay. clickWand seeds each shot's fire_rate_wait WITH castDelay
// (clickWand.ts:233), then actions mutate it; so castState.fire_rate_wait is the
// COMPLETE per-shot delay — do NOT add castDelay again. Floored at 1 FRAME (not 0):
// Noita fires at most once per frame (the 60 casts/s ceiling) and "a negative Cast
// Delay value is treated as 1 frame" (noita.wiki.gg/wiki/Wands + Guide:_Rapid-Fire_
// Wands). WITHOUT this floor a maxed-fast wand (fire_rate_wait ≤ 0, e.g. Luminous
// Drill) gives a 0-frame cycle → every rate (DPS, projectiles/s) divides to 0, so the
// BEST wands score 0. Normal wands have ≥1 frame/shot, so this is a no-op for them.
function perShotFrames(shot: WandShot, stats: WandStats): number {
  return Math.max(1, shot.castState?.fire_rate_wait ?? stats.castDelay)
}

/** Max trigger/timer nesting we descend. Real chains are shallow; this only guards a
 *  pathological deep tree (the engine builds fresh WandShots, so there is no cycle). */
const TRIGGER_DEPTH_CAP = 16

/** Expected damage multiplier from accumulated crit chance — the multiplicative
 *  stacking the meta is built on. Noita's formula (noita.wiki.gg/wiki/Critical_hit):
 *  TotalDamage = Base × (1 + min(c,1)·(5·max(1,c) − 1)), c = critChance fraction. So
 *  0% → ×1 (no change, goldens safe), 25% → ×2, 100% → ×5, 200% → ×10. Crit chance is
 *  populated by real actions (crit spells / triggers add it); the ×5 is the game
 *  constant, not stored in the action state. Applies to direct projectile damage. */
function critMultiplier(critChancePercent: number): number {
  const c = Math.max(0, critChancePercent) / 100
  return 1 + Math.min(c, 1) * (5 * Math.max(1, c) - 1)
}

// Damage types in damageByType that DON'T reduce an enemy's HP, so they must be
// excluded from a damage sum: `healing` is negative (it HEALS the target —
// regeneration_field carries healing:-0.05). Everything else (slice, electricity,
// melee, ice, fire, drill, radioactive…) deals real enemy HP. (Audit: Damage_types;
// noita.wiki.gg/wiki/Damage_types.) Used by the reach weighting now and by the typed-
// damage sum (B1) — kept here so the two never diverge.
const NON_DAMAGE_TYPES: ReadonlySet<string> = new Set(['healing'])

/** Sum of a projectile's TYPED damage (damage_by_type), excluding non-damage types
 *  (healing). 0 when untyped. In the same 1.0 = 25 HP unit as `damage`. */
function typedDmg(st: ProjectileStats): number {
  if (!st.damageByType) return 0
  let sum = 0
  for (const [t, v] of Object.entries(st.damageByType)) if (!NON_DAMAGE_TYPES.has(t)) sum += v
  return sum
}

/** A projectile that never dies has effectively unlimited reach (full credit). A large
 *  finite sentinel keeps the damage-weighted average finite (Infinity would poison it). */
const REACH_ENDLESS = 1e6

/** How far a projectile travels before it dies (px), the usable single-target range.
 *  `lifetime < 0` = endless (full credit); `speedMax <= 0` = stationary (0). Mirrors
 *  selfDanger.reachOf, the one reach heuristic in the codebase. */
function reachOfStats(st: ProjectileStats): number {
  if (st.lifetime < 0) return REACH_ENDLESS
  if (st.speedMax <= 0) return 0
  return (st.speedMax * st.lifetime) / 60
}

// Expected HP of one shot INCLUDING its trigger payloads: every top-level projectile
// gets the shot's accumulated damage_*_add (1.0 = 25 HP), plus its explosion when it
// explodes; and a TRIGGER projectile recursively adds the damage its payload delivers
// on impact (the payload is its own WandShot with its own castState). This is "damage
// per cast assuming the trigger connects" — optimistic, like the single-hit model
// elsewhere. Without the recursion the entire trigger meta reads as ~0 damage.
function shotDamage(shot: WandShot, onMissing: () => void, depth = 0): number {
  const projAdd = shot.castState?.damage_projectile_add ?? 0
  const explAdd = shot.castState?.damage_explosion_add ?? 0
  // Crit is a shot-level stat (accumulated from this shot's draws), so it multiplies
  // every projectile in the shot; a trigger payload's own crit applies in its recursion.
  const critMul = critMultiplier(shot.castState?.damage_critical_chance ?? 0)
  let hp = 0
  for (const p of shot.projectiles) {
    const st = getProjectileStats(p.entity)
    if (st) {
      // Total direct HP = untyped `damage` + every damage_by_type entry (slice, electricity,
      // melee, fire-on-hit, ice, …) except non-damage types (healing heals the enemy). Without
      // the typed sum, CHAINSAW (slice 0.51) and every typed-only carrier read 0 HP. (B1;
      // grounded noita.wiki.gg/wiki/Damage_types — typed damage is real enemy HP, additive.)
      hp += Math.max(0, st.damage + typedDmg(st) + projAdd) * DAMAGE_UNIT_HP * critMul
      if (st.explosionDamage > 0 || explAdd > 0) {
        // Crit applies to ALL damage types, not just projectile damage — including the
        // explosion (B2a; noita.wiki.gg/wiki/Critical_hit). ×1 when no crit (goldens safe).
        hp += Math.max(0, st.explosionDamage + explAdd) * DAMAGE_UNIT_HP * critMul
      }
    } else {
      onMissing() // modded base — damage understated, but still descend its payload
    }
    if (p.trigger && depth < TRIGGER_DEPTH_CAP) {
      hp += shotDamage(p.trigger, onMissing, depth + 1)
    }
  }
  return hp
}

export function computeMetrics(
  shots: WandShot[],
  reloadTime: number | undefined,
  stats: WandStats,
  hitIterationLimit: boolean,
): WandMetrics {
  // --- timing ---
  // fireFrames = total active-firing frames in one cycle (Σ per-shot cast delay).
  const fireFrames = shots.reduce((sum, s) => sum + perShotFrames(s, stats), 0)
  // Cast delay and recharge run SIMULTANEOUSLY in Noita, and recharge only starts
  // once the deck EMPTIES — so it overlaps ONLY the final shot's cast delay, not the
  // whole sequence: "Cast Delay occurs simultaneously with Recharge Time… they don't
  // add to each other", and recharge "is only triggered after all spells in the wand
  // have been cast" (noita.wiki.gg/wiki/Wands). So the steady-state cycle for S shots
  // with per-shot delays d_1..d_S and recharge R is (d_1+…+d_{S-1}) + max(d_S, R),
  // NOT the old additive ΣD + R — which double-counted the final-delay/recharge
  // overlap and understated DPS on high-recharge / low-cast-delay wands. R has its
  // OWN floor at 0 (wiki: "a negative Recharge Time value is treated as zero"),
  // separate from the per-shot 1-frame floor inside perShotFrames.
  const n = shots.length
  const lastShotFrames = n > 0 ? perShotFrames(shots[n - 1], stats) : 0
  const recharge = Math.max(0, reloadTime ?? 0)
  const cycleFrames =
    n === 0 ? 0 : Math.max(1, fireFrames - lastShotFrames + Math.max(lastShotFrames, recharge))
  const cycleSeconds = framesToSeconds(cycleFrames)
  const fireSeconds = framesToSeconds(fireFrames)

  // --- throughput ---
  const projectilesPerCast = shots[0]?.projectiles.length ?? 0
  const projectilesPerCycle = shots.reduce((n, s) => n + s.projectiles.length, 0)
  const projectilesPerSecond = cycleSeconds > 0 ? projectilesPerCycle / cycleSeconds : 0

  // --- damage / DPS ---
  let damageApproximate = false
  const onMissing = () => {
    damageApproximate = true
  }
  const damagePerCast = shots[0] ? shotDamage(shots[0], onMissing) : 0
  const damagePerCycle = shots.reduce((hp, s) => hp + shotDamage(s, onMissing), 0)
  const sustainedDps = cycleSeconds > 0 ? damagePerCycle / cycleSeconds : 0
  const burstDps = fireSeconds > 0 ? damagePerCycle / fireSeconds : 0

  // --- mana sustainability ---
  const manaPerCycle = shots.reduce((m, s) => m + (s.manaDrain ?? 0), 0)
  const regenPerCycle = stats.manaChargeSpeed * cycleSeconds
  const manaSustainable = manaPerCycle <= regenPerCycle
  // Effective sustained DPS: a mana shortfall DROPS casts (it doesn't slow the clock —
  // engine gun.ts:333 discards an unaffordable card that round), so over a sustained fight
  // the wand delivers only the fraction of full output that regen can pay for: × min(1,
  // regen/drain). IDENTITY when the wand sustains its own fire (ratio 1 ⇒ effective == raw),
  // so a sustainable wand's headline is unchanged. Only out-draining wands are pulled down,
  // smoothly (a 10%-over-drain wand loses ~9%, not a cliff). (B4; docs/scoring-rebuild-spec.md
  // §1; grounded noita.wiki.gg/wiki/Wands mana.) Negative drain (Add Mana) ⇒ ratio 1.
  const manaRatio = manaPerCycle > 0 ? Math.min(1, regenPerCycle / manaPerCycle) : 1
  const effectiveSustainedDps = sustainedDps * manaRatio
  let secondsUntilStall: number | null = null
  if (!manaSustainable && cycleSeconds > 0) {
    const netDrainPerSecond = (manaPerCycle - regenPerCycle) / cycleSeconds
    // Starts from the CURRENT pool (stats.mana) — answers "from now", so a
    // partially-depleted wand reports a shorter stall than its steady state.
    secondsUntilStall = stats.mana / netDrainPerSecond
  }

  // --- spread / AoE ---
  const effectiveSpread = stats.spread + (shots[0]?.castState?.spread_degrees ?? 0)
  // Largest blast the wand makes — RADIUS and DAMAGE — descending trigger payloads
  // (a trigger→bomb's explosion lives in the payload, invisible at top level). Radius
  // = a projectile's intrinsic radius + the shot's modifier delta; damage likewise.
  // Tracking damage separately lets AoE scoring reward a lethal blast over a harmless
  // digging explosion (same radius, 0 damage).
  let maxExplosionRadius = 0
  let maxExplosionDamage = 0
  // Damage-weighted reach: Σ(perProjectileDamage × reach) / Σ(perProjectileDamage) over the
  // whole cycle (recursing payloads). Weighting by damage means a mostly-ranged deck stays
  // "ranged" even with a little close-range filler, and a deck whose damage is mostly a
  // short-range beam reads close-range. The weight uses direct + typed + intrinsic explosion
  // damage (the projectile's full damage potential), independent of the HP scoring path.
  let reachNumer = 0
  let reachDenom = 0
  // Status/DoT capability (see WandMetrics.appliesDot). Detected from data we actually
  // have: per-projectile typed FIRE damage; a shot-level material the whole shot deposits
  // (NUKE → material 'fire'; TRAIL_FIRE/POISON/TOXIC accumulate into trail_material as
  // 'fire,'/'poison,'/'acid,'); and poison/acid-spraying projectiles, whose stain isn't a
  // damage field (so we match the entity path — poison_blast, bullet_poison, acidshot,
  // cloud_acid, …). Honest LIMITS: poison/toxic puddle uptime/size isn't in our data, so
  // this is a capability flag, never a DoT-HP number; and a few pure-explosion fire
  // emitters that ignite without a `damage_by_type.fire` (e.g. fireblast) are missed —
  // path-matching 'fire' is NOT clean (it would trip `..._friendly_fire`), so we accept
  // the minor false-negative over a brittle curated allowlist.
  const appliesDot = { fire: false, poison: false, toxic: false }
  const scanProjectileTree = (shot: WandShot, depth: number): void => {
    const radiusAdd = shot.castState?.explosion_radius ?? 0
    const explAdd = shot.castState?.damage_explosion_add ?? 0
    // Crit scales the blast too (B2b) — a crit nuke's AoE is bigger. ×1 with no crit.
    const critMul = critMultiplier(shot.castState?.damage_critical_chance ?? 0)
    const material = shot.castState?.material ?? ''
    const trail = shot.castState?.trail_material ?? ''
    if (material === 'fire' || trail.includes('fire')) appliesDot.fire = true
    if (trail.includes('poison')) appliesDot.poison = true
    if (trail.includes('acid')) appliesDot.toxic = true
    for (const p of shot.projectiles) {
      const st = getProjectileStats(p.entity)
      if (st) {
        const w = Math.max(0, st.damage + typedDmg(st)) + Math.max(0, st.explosionDamage)
        if (w > 0) {
          reachDenom += w
          reachNumer += w * reachOfStats(st)
        }
      }
      const r = (st?.explosionRadius ?? 0) + radiusAdd
      if (r > maxExplosionRadius) maxExplosionRadius = r
      const baseExpl = st?.explosionDamage ?? 0
      const dHp = (baseExpl > 0 || explAdd > 0 ? Math.max(0, baseExpl + explAdd) : 0) * DAMAGE_UNIT_HP * critMul
      if (dHp > maxExplosionDamage) maxExplosionDamage = dHp
      if ((st?.damageByType?.fire ?? 0) > 0) appliesDot.fire = true
      if (p.entity.includes('poison')) appliesDot.poison = true
      if (p.entity.includes('acid')) appliesDot.toxic = true
      if (p.trigger && depth < TRIGGER_DEPTH_CAP) scanProjectileTree(p.trigger, depth + 1)
    }
  }
  for (const s of shots) scanProjectileTree(s, 0)
  // No damage anywhere ⇒ 0 (range is irrelevant to a 0-DPS deck; the scorer floors it).
  const reachWeightedPx = reachDenom > 0 ? reachNumer / reachDenom : 0

  return {
    shotsUntilReload: shots.length,
    cycleFrames,
    cycleSeconds,
    fireSeconds,
    projectilesPerCast,
    projectilesPerCycle,
    projectilesPerSecond,
    damagePerCast,
    damagePerCycle,
    sustainedDps,
    effectiveSustainedDps,
    burstDps,
    manaPerCycle,
    manaSustainable,
    secondsUntilStall,
    effectiveSpread,
    reachWeightedPx,
    maxExplosionRadius,
    maxExplosionDamage,
    appliesDot,
    truncated: hitIterationLimit,
    damageApproximate,
  }
}
