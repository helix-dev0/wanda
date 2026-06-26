// Cited reference enemies + meta constants for the TTK scorer (scoring-model-v2-spec §5.2).
// HP are the wiki's INTERNAL values (the in-game UI shows ×25 for bosses). #9: these are
// cited facts grounded in enemy-HP data, NOT numbers tuned to match human wand tiers.
// The snapshot carries no biome/depth (verified src/schema/snapshot.ts), so the reference
// set is FIXED and absolute; stage-aware references are deferred (§5.2).

export interface ReferenceEnemy {
  readonly name: string
  readonly hp: number
  readonly url: string
}

export const REFERENCE_ENEMIES = {
  /** Weak swarm unit — the AOE/SPAM yardstick (the Mines-floor variant is 9; use 22.5). */
  weakMob: { name: 'Haulikkohiisi (Shotgunner)', hp: 22.5, url: 'https://noita.wiki.gg/wiki/Haulikkohiisi' },
  /** Mid bruiser — single tough target (Underground-Jungle variant is 300; use normal 150). */
  midBruiser: { name: 'Isohiisi (Big Hiisi)', hp: 150, url: 'https://noita.wiki.gg/wiki/Isohiisi' },
  /** Boss sponge — FIXED HP. NOT Kolmisilmä (HP = 25·{46 + 2^(orbs+1.3) + 15.5·orbs} scales
   *  to trillions); Ylialkemisti is the fixed anchor. */
  bossSponge: { name: 'Ylialkemisti (High Alchemist)', hp: 1000, url: 'https://noita.wiki.gg/wiki/Ylialkemisti' },
} as const satisfies Record<string, ReferenceEnemy>

/** Fire/poison/toxic stains tick ~2% of MAX HP per second (§5.1). The literal sub-second
 *  tick interval is UNVERIFIED (§9.1) — treat as a 2%/s rate, never a frame count. */
export const DOT_RATE_PER_SEC = 0.02
/** … and they FLOOR at ~2% HP: "you will never actually be killed directly from stain
 *  damage." So DoT softens a high-HP target toward ~2% HP; the projectile lands the kill. */
export const DOT_FLOOR_FRACTION = 0.02

/** A reference swarm = this many weak mobs in a cluster. PROVISIONAL — the spec says "a
 *  swarm" without a count; the meta-expert sets it (§5.6/§7). */
export const REFERENCE_SWARM = 8
/** Mob spacing (px) for converting blast radius / penetration path → number of mobs hit.
 *  PROVISIONAL (meta-expert tunes). */
export const MOB_SPACING_PX = 24
