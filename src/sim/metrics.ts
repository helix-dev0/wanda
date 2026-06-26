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
  /** Seconds the FIRST cast takes (the first shot's per-shot delay). The TTK overkill
   *  floor: a wand that one-shots the reference enemy kills in this time, so two
   *  one-shotters are ordered by cadence, not collapsed to the full cycle. */
  firstCastSeconds: number

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
  /** The ACHIEVABLE peak HP/sec: the most damage the wand can actually deliver in a ~1s window,
   *  front-loading casts but bounded by BOTH recharge (idle between cycles) and MANA (start full
   *  + 1s regen). NOT "damage ÷ a 1-frame firing window" (which invented unrepeatable nova rates).
   *  Always ≥ effectiveSustainedDps (it's an upside), and a mana-starved nova can burst only
   *  briefly. See the derivation in computeMetrics. */
  burstDps: number

  manaPerCycle: number
  manaSustainable: boolean
  /** Seconds of continuous fire before mana stalls; null = sustainable forever. */
  secondsUntilStall: number | null

  /** Wand base spread + the cast's accumulated spread (degrees; may be negative). */
  effectiveSpread: number
  /** Damage-weighted range usability in [0,1] — what FRACTION of the wand's single-target
   *  damage actually reaches an engaged enemy. 1 = fully ranged (every fired projectile +
   *  combat beam + explosion); low = a contact/digging tool used as a "damage" wand (drill,
   *  chainsaw, tentacles). Classified PER PROJECTILE by weapon KIND — digging/melee, NOT
   *  ballistic distance (which fails in Noita; see `isCloseRangeProjectile`) — then damage-
   *  weighted, so a mostly-contact deck reads close even with one ranged shot. The scorer
   *  multiplies DAMAGE/SPAM effective DPS by this. 1 when the deck deals no damage (range moot). */
  reachUsability: number
  /** Largest explosion radius produced in the cycle (px); 0 if none. */
  maxExplosionRadius: number
  /** Largest explosion DAMAGE produced in the cycle (HP); 0 if none. Separates a
   *  lethal blast from a harmless digging explosion (same radius, no damage). */
  maxExplosionDamage: number

  /** Penetration capability for AOE coverage (reference-agnostic — the analysis layer
   *  turns px → mob count via the reference swarm spacing). The farthest a PENETRATING
   *  projectile (`penetrate_entities`) travels in the cycle (px); 0 if nothing penetrates.
   *  A penetrating projectile hits one body per mob along this path. */
  pierceReachPx: number
  /** The largest per-HIT combat HP among the cycle's penetrating projectiles (incl. the
   *  shot's damage/crit mods); 0 if nothing penetrates. The scorer gates coverage on this:
   *  a penetrating projectile that can't kill the reference mob (e.g. Black Hole, 0 dmg)
   *  clears nothing despite a long path. */
  pierceHitHP: number

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
 *  `lifetime < 0` = endless (full credit); `speedMax <= 0` = stationary (0). */
function reachOfStats(st: ProjectileStats): number {
  if (st.lifetime < 0) return REACH_ENDLESS
  if (st.speedMax <= 0) return 0
  return (st.speedMax * st.lifetime) / 60
}

/** Reach factor for a contact/digging weapon's DIRECT damage — it can't reliably reach an
 *  engaged enemy, so that damage barely counts toward ranged single-target DPS. */
const REACH_FLOOR = 0.1

/** Below this projectile flight (px) a slice/melee-damage projectile is a genuine MELEE swing
 *  (chainsaw 7px, tentacle 8px), not a ranged slicer (arrow 8125px, disc, bouncy 6250px). */
const MELEE_REACH_PX = 16

/** Untyped DIGGING beams: their damage is plain `damage`, NOT the `drill` type, so neither
 *  damage-type nor ballistic distance flags them as the digging tools they are (Luminous Drill
 *  reads 47px — farther than Chain Bolt's 29px). Curated by entity substring; the classifier's
 *  correctness is load-bearing on these strings, so a canary test (metrics.test.ts) asserts the
 *  `luminous_drill` entity still exists in the projectile table (fail loudly on a version rename).
 *  `digging_bolt` is a real vanilla spell pre-registered here but ABSENT from the current
 *  projectile-stats snapshot (no entry yet) — harmless until it appears. Drill-TYPE diggers
 *  (digger / powerdigger / xray) carry `damageByType.drill` and need no entry here. */
const DIGGING_BEAM_ENTITIES: readonly string[] = ['luminous_drill', 'digging_bolt']

/**
 * Does this projectile deliver CLOSE-RANGE (contact/digging) damage that must NOT count as ranged
 * single-target DPS? Grounded in weapon KIND, not ballistic distance — distance is unusable in
 * Noita: a slow ranged bolt (Chain Bolt 29px) under-reaches a digging beam (Luminous Drill 47px),
 * and a powerful combat beam (Megalaser) barely moves (~1px). A weapon is close-range iff it DIGS
 * (drill damage-type, or a curated untyped digging beam) or is MELEE (slice/melee damage delivered
 * within MELEE_REACH_PX). Everything else — every FIRED projectile and combat beam — reaches at
 * range. Validated across all vanilla projectiles: only diggers + chainsaw/tentacles/tongue
 * classify close; Chain Bolt, Megalaser, Laser, bombs (via their blast) all stay ranged. */
function isCloseRangeProjectile(entity: string, st: ProjectileStats): boolean {
  if ((st.damageByType?.drill ?? 0) > 0) return true // digger / powerdigger / xray
  if (DIGGING_BEAM_ENTITIES.some((d) => entity.includes(d))) return true // luminous drill (untyped)
  const sliceMelee = (st.damageByType?.slice ?? 0) + (st.damageByType?.melee ?? 0)
  return sliceMelee > 0 && reachOfStats(st) < MELEE_REACH_PX // chainsaw / tentacle / tongue swing
}

/** A projectile's COMBAT damage (enemy HP) in the 1.0 = 25 HP unit: untyped `damage` + typed
 *  damage_by_type, MINUS digging. DIGGING is excluded because terrain-carving is not combat damage
 *  — counting it (a) inflated diggers as "damage" (crit/multicast could lift the original Luminous-
 *  Drill bug back) and (b) dragged a real ranged payload's reach when a drill ENABLER rode along.
 *  Excluded: `drill`-type damage, and the curated untyped digging beams (Luminous Drill). A pure
 *  digger → 0 combat ⇒ ~0 DAMAGE score (demoted by zero offensive output, not by the reach floor).
 *  Melee (chainsaw slice) IS combat damage — it counts, but the reach factor floors its short range. */
function combatDamage(entity: string, st: ProjectileStats): number {
  if (DIGGING_BEAM_ENTITIES.some((d) => entity.includes(d))) return 0
  const drill = st.damageByType?.drill ?? 0
  return Math.max(0, st.damage + typedDmg(st) - drill)
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
      // Direct HP = combat damage (untyped + typed slice/electricity/melee/fire/ice/…, B1) MINUS
      // digging (drill / curated digging beams are terrain work, not combat — see combatDamage),
      // plus the shot's damage_projectile_add. Without the typed sum CHAINSAW (slice) read 0; with
      // the digging exclusion a drill ENABLER no longer counts as offensive damage.
      hp += Math.max(0, combatDamage(p.entity, st) + projAdd) * DAMAGE_UNIT_HP * critMul
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
  const firstCastSeconds = n > 0 ? framesToSeconds(perShotFrames(shots[0], stats)) : 0

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
  const manaPerCycle = shots.reduce((m, s) => m + (s.manaDrain ?? 0), 0)

  // Burst = the highest damage rate the wand can ACTUALLY hold for a brief engagement — NOT the
  // fictional rate of dividing one cast's damage by a ~1-frame firing window (which read ~2600 HP/s
  // for a multicast nova whose real peak is ~200, letting unsustainable novas dominate DAMAGE). We
  // bound it the way the game does: over a 1-second window, front-load shots but fire at most as
  // many cycles as (a) TIME allows — recharge idles between cycles — and (b) MANA pays for (start
  // full + 1s regen): "damage you can pay for" (Principle 5). So a wand that out-drains its mana
  // can burst only for a fraction of a second, and a fast sustainable wand's burst ≈ sustained.
  const BURST_WINDOW_S = 1
  let burstDps = 0
  if (cycleSeconds > 0 && damagePerCycle > 0) {
    const fullByTime = Math.floor(BURST_WINDOW_S / cycleSeconds)
    const partialByTime =
      fireSeconds > 0 ? Math.min(1, (BURST_WINDOW_S - fullByTime * cycleSeconds) / fireSeconds) : 1
    const cyclesByTime = fullByTime + partialByTime
    const manaBudget = stats.manaMax + stats.manaChargeSpeed * BURST_WINDOW_S // start full + 1s regen
    const cyclesByMana = manaPerCycle > 0 ? manaBudget / manaPerCycle : Infinity
    burstDps = (damagePerCycle * Math.min(cyclesByTime, cyclesByMana)) / BURST_WINDOW_S
  }

  // --- mana sustainability ---
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
  // Penetration capability (AOE coverage). Tracked over the whole cycle (incl. trigger
  // payloads): the farthest a penetrating projectile travels, and the largest per-hit
  // combat HP among penetrating projectiles. Kept as two independent maxes — the scorer
  // needs BOTH (a long-reach 0-damage Black Hole clears nothing; a lethal Chain Bolt does).
  let pierceReachPx = 0
  let pierceHitHP = 0
  // Damage-weighted range USABILITY: Σ(perProjectileDamage × perProjectileReachFrac) /
  // Σ(perProjectileDamage) over the whole cycle (recursing payloads). Each projectile's reach
  // is clamped to [FLOOR,1] BEFORE weighting, so a deck whose damage is mostly a short-range
  // beam reads close-range even if it also holds one ultra-long-range shot. The weight uses
  // direct + typed + intrinsic explosion damage (the projectile's full damage potential).
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
    const projAdd = shot.castState?.damage_projectile_add ?? 0
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
        // Weight reach by COMBAT damage (digging excluded → a drill enabler contributes 0 and can't
        // drag a real payload's reach). Direct combat damage reaches at range UNLESS the weapon is
        // MELEE (chainsaw); the EXPLOSION reaches wherever the projectile lands, so it always gets
        // full reach — even a lobbed explosive (Bomb/Mine, config speedMax=0) is thrown, not melee.
        const directW = combatDamage(p.entity, st)
        const explW = Math.max(0, st.explosionDamage)
        if (directW + explW > 0) {
          reachDenom += directW + explW
          const directFrac = isCloseRangeProjectile(p.entity, st) ? REACH_FLOOR : 1
          reachNumer += directW * directFrac + explW
        }
      }
      const r = (st?.explosionRadius ?? 0) + radiusAdd
      if (r > maxExplosionRadius) maxExplosionRadius = r
      const baseExpl = st?.explosionDamage ?? 0
      const dHp = (baseExpl > 0 || explAdd > 0 ? Math.max(0, baseExpl + explAdd) : 0) * DAMAGE_UNIT_HP * critMul
      if (dHp > maxExplosionDamage) maxExplosionDamage = dHp
      // Penetration: a `penetrate_entities` projectile passes through bodies along its
      // flight path. Its per-hit combat HP (incl. this shot's projectile-add + crit) gates
      // whether each pass is lethal. Reach + lethality tracked as independent maxes.
      if (st?.penetrateEntities) {
        const reachPx = reachOfStats(st)
        if (reachPx > pierceReachPx) pierceReachPx = reachPx
        const hitHP = Math.max(0, combatDamage(p.entity, st) + projAdd) * DAMAGE_UNIT_HP * critMul
        if (hitHP > pierceHitHP) pierceHitHP = hitHP
      }
      if ((st?.damageByType?.fire ?? 0) > 0) appliesDot.fire = true
      if (p.entity.includes('poison')) appliesDot.poison = true
      if (p.entity.includes('acid')) appliesDot.toxic = true
      if (p.trigger && depth < TRIGGER_DEPTH_CAP) scanProjectileTree(p.trigger, depth + 1)
    }
  }
  for (const s of shots) scanProjectileTree(s, 0)
  // No damage anywhere ⇒ 1 (range is moot for a 0-DPS deck; its score is ~0 regardless).
  const reachUsability = reachDenom > 0 ? reachNumer / reachDenom : 1

  return {
    shotsUntilReload: shots.length,
    cycleFrames,
    cycleSeconds,
    fireSeconds,
    firstCastSeconds,
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
    reachUsability,
    maxExplosionRadius,
    maxExplosionDamage,
    pierceReachPx,
    pierceHitHP,
    appliesDot,
    truncated: hitIterationLimit,
    damageApproximate,
  }
}
