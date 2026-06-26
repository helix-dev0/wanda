// Scoring-v2 validation corpus — documented builds used as a ground-truth loop
// for the sim + scorer (docs/scoring-model-v2-spec.md §7, scoring-validation-spec.md).
//
// INVARIANT #9: the oracle is a documented MECHANIC / PURPOSE, never a human tier
// label. Each build is constructed to exercise a mechanic the cited wiki page
// describes (triggers, multicast broadcast, crit stacking, penetration, digging
// sustainability, …); `provenanceURL` points at that page, `documentedKeyBehavior`
// states the mechanic, and `documentedArchetype` is the build's META PURPOSE. We
// never copy a community tier. The spell IDs are our own (the salinecitrine /wiki
// share format uses the same IDs), so this IS the "direct import" the spec calls for.
//
// Builds use only engine-simulable action IDs (src/engine/__generated__/gun_actions.ts);
// the Layer-A harness asserts `sim.approximate === false`, which proves every ID resolves.

import type { WandStats } from '../../schema/snapshot'

/** The v2 archetype set this corpus targets (DIGGING becomes a real Archetype at S4;
 *  kept local so the corpus is forward-looking and decoupled from the current enum). */
export type CorpusArchetype = 'DAMAGE' | 'AOE' | 'SPAM' | 'DIGGING'

export interface CorpusBuild {
  /** Stable kebab id, used by the harness to target per-build assertions. */
  id: string
  /** The wiki page documenting the mechanic this build exercises (provenance). */
  provenanceURL: string
  /** The build's documented META PURPOSE — the Layer-B routing oracle (a purpose, never a tier). */
  documentedArchetype: CorpusArchetype
  /** The mechanic the build demonstrates — the Layer-A fidelity oracle. */
  documentedKeyBehavior: string
  spellIds: string[]
  alwaysCast: string[]
  stats: WandStats
  /** Documented mechanics the sim must reproduce (Layer A). Only fields that exist
   *  pre-v2 are asserted in S0; richer ones (pierceN) arrive with the metrics slice. */
  documented?: {
    projectilesPerCast?: number
    hasTrigger?: boolean
    manaSustainable?: boolean
  }
}

/** A roomy, neutral chassis so multicast decks fit and mana isn't the variable under
 *  test (overridden per-build where mana economy IS the point). Mirrors the
 *  `metricsForDeck` test chassis (src/sim/metrics.test.ts) for consistency. */
const chassis = (over: Partial<WandStats> = {}): WandStats => ({
  shuffle: false,
  spellsPerCast: 1,
  castDelay: 10,
  rechargeTime: 20,
  manaMax: 1000,
  mana: 1000,
  manaChargeSpeed: 100,
  capacity: 26,
  spread: 0,
  speedMultiplier: 1,
  ...over,
})

const WIKI = 'https://noita.wiki.gg/wiki'

export const CORPUS: CorpusBuild[] = [
  // ---- DAMAGE: single-target, payload delivery, multiplier engine -----------------
  {
    id: 'bare-light-bullet',
    provenanceURL: `${WIKI}/Spark_Bolt`,
    documentedArchetype: 'SPAM',
    documentedKeyBehavior: 'a single weak ranged projectile — the baseline carrier',
    spellIds: ['LIGHT_BULLET'],
    alwaysCast: [],
    stats: chassis(),
    documented: { projectilesPerCast: 1, hasTrigger: false, manaSustainable: true },
  },
  {
    id: 'trigger-heavy-payload',
    provenanceURL: `${WIKI}/Add_Trigger`,
    documentedArchetype: 'DAMAGE',
    documentedKeyBehavior:
      'Add Trigger makes the carrier a trigger that casts a heavy-bullet payload on impact (a trigger is a miniature wand)',
    spellIds: ['ADD_TRIGGER', 'LIGHT_BULLET', 'HEAVY_BULLET'],
    alwaysCast: [],
    stats: chassis(),
    documented: { hasTrigger: true },
  },
  {
    id: 'nested-trigger-chain',
    provenanceURL: `${WIKI}/Add_Trigger`,
    documentedArchetype: 'DAMAGE',
    documentedKeyBehavior: 'two-level trigger chain — carrier triggers a carrier that triggers a heavy payload',
    spellIds: ['ADD_TRIGGER', 'LIGHT_BULLET', 'ADD_TRIGGER', 'LIGHT_BULLET', 'HEAVY_BULLET'],
    alwaysCast: [],
    stats: chassis(),
    documented: { hasTrigger: true },
  },
  {
    id: 'crit-stack',
    provenanceURL: `${WIKI}/Critical_hit`,
    documentedArchetype: 'DAMAGE',
    documentedKeyBehavior: 'stacked critical chance multiplies the hit (crit = ×5 base, multiplicative)',
    spellIds: ['CRITICAL_HIT', 'CRITICAL_HIT', 'HEAVY_BULLET'],
    alwaysCast: [],
    stats: chassis(),
    documented: { projectilesPerCast: 1, hasTrigger: false },
  },
  {
    id: 'damage-broadcast-multicast',
    provenanceURL: `${WIKI}/Guide:_Wand_Mechanics`,
    documentedArchetype: 'DAMAGE',
    documentedKeyBehavior: 'a Damage Plus modifier before a triple-cast broadcasts to all 3 projectiles',
    spellIds: ['DAMAGE', 'BURST_3', 'LIGHT_BULLET', 'LIGHT_BULLET', 'LIGHT_BULLET'],
    alwaysCast: [],
    stats: chassis(),
    documented: { projectilesPerCast: 3, hasTrigger: false },
  },
  {
    id: 'tight-burst',
    provenanceURL: `${WIKI}/Guide:_Wand_Mechanics`,
    documentedArchetype: 'DAMAGE',
    documentedKeyBehavior: 'triple-cast at zero spread keeps all projectiles on one target (the bare multicast baseline)',
    spellIds: ['BURST_3', 'LIGHT_BULLET', 'LIGHT_BULLET', 'LIGHT_BULLET'],
    alwaysCast: [],
    stats: chassis({ spread: 0 }),
    documented: { projectilesPerCast: 3, hasTrigger: false },
  },
  {
    id: 'wide-scatter',
    provenanceURL: `${WIKI}/Heavy_Spread`,
    documentedArchetype: 'DAMAGE',
    documentedKeyBehavior:
      'the same triple-cast with Heavy Spread fans the projectiles wide — a single-target DAMAGE foil that loses on-target fraction to spread',
    spellIds: ['HEAVY_SPREAD', 'BURST_3', 'LIGHT_BULLET', 'LIGHT_BULLET', 'LIGHT_BULLET'],
    alwaysCast: [],
    stats: chassis({ spread: 0 }),
    documented: { projectilesPerCast: 3, hasTrigger: false },
  },
  {
    id: 'boss-killer-heavy',
    provenanceURL: `${WIKI}/Expert_Guide:_High_Damage_Wands`,
    documentedArchetype: 'DAMAGE',
    documentedKeyBehavior: 'stacked Damage Plus + Heavy Shot on a heavy bullet = a high single-target hit',
    spellIds: ['DAMAGE', 'DAMAGE', 'HEAVY_SHOT', 'HEAVY_BULLET'],
    alwaysCast: [],
    stats: chassis(),
    documented: { projectilesPerCast: 1, hasTrigger: false },
  },

  // ---- SPAM: sustained, mana-holdable -------------------------------------------
  {
    id: 'sustainable-spammer',
    provenanceURL: `${WIKI}/Guide:_Rapid-Fire_Wands`,
    documentedArchetype: 'SPAM',
    documentedKeyBehavior: 'cheap rapid bullets the wand can pay for indefinitely (mana-sustainable)',
    spellIds: ['HEAVY_BULLET', 'HEAVY_BULLET'],
    alwaysCast: [],
    stats: chassis({ manaMax: 1000, mana: 1000, manaChargeSpeed: 400, castDelay: 6, rechargeTime: 10 }),
    documented: { manaSustainable: true },
  },
  {
    id: 'starved-spammer',
    provenanceURL: `${WIKI}/Guide:_Rapid-Fire_Wands`,
    documentedArchetype: 'SPAM',
    documentedKeyBehavior: 'the same rapid bullets out-drain a weak mana pool and stall (mana is a hard gate)',
    spellIds: ['HEAVY_BULLET', 'HEAVY_BULLET'],
    alwaysCast: [],
    stats: chassis({ manaMax: 60, mana: 60, manaChargeSpeed: 8, castDelay: 6, rechargeTime: 10 }),
    documented: { manaSustainable: false },
  },

  // ---- AOE: clear a cluster -----------------------------------------------------
  {
    id: 'nuke-aoe',
    provenanceURL: `${WIKI}/Nuke`,
    documentedArchetype: 'AOE',
    documentedKeyBehavior: 'one huge explosion clears a whole cluster',
    spellIds: ['NUKE'],
    alwaysCast: [],
    stats: chassis(),
    documented: { projectilesPerCast: 1, hasTrigger: false },
  },
  {
    id: 'chain-bolt-penetrating',
    provenanceURL: `${WIKI}/Chain_Bolt`,
    documentedArchetype: 'AOE',
    documentedKeyBehavior: 'a penetrating bolt passes through and hits many enemy bodies along its path',
    spellIds: ['CHAIN_BOLT'],
    alwaysCast: [],
    stats: chassis(),
    documented: { projectilesPerCast: 1, hasTrigger: false },
  },
  {
    id: 'bomb-trigger-fan',
    provenanceURL: `${WIKI}/Add_Trigger`,
    documentedArchetype: 'AOE',
    documentedKeyBehavior: 'a bubbleshot carrier wrapped by Add Trigger that casts a bomb on impact (trigger→blast)',
    spellIds: ['ADD_TRIGGER', 'BUBBLESHOT', 'BOMB'],
    alwaysCast: [],
    stats: chassis(),
    documented: { hasTrigger: true },
  },

  // ---- DIGGING: capability × sustainability -------------------------------------
  {
    id: 'luminous-drill-digger',
    provenanceURL: `${WIKI}/Luminous_Drill`,
    documentedArchetype: 'DIGGING',
    documentedKeyBehavior: 'top-tier dig (breaks everything but Cursed Rock); 10 mana, −cast-delay, sustains continuously',
    spellIds: ['LUMINOUS_DRILL'],
    alwaysCast: [],
    stats: chassis(),
    documented: { hasTrigger: false },
  },
  {
    id: 'black-hole-digger',
    provenanceURL: `${WIKI}/Black_Hole`,
    documentedArchetype: 'DIGGING',
    documentedKeyBehavior: 'digs anything incl. Cursed Rock, but 180 mana + 80 cast-delay → not sustainable',
    spellIds: ['BLACK_HOLE'],
    alwaysCast: [],
    stats: chassis(),
    documented: { hasTrigger: false },
  },
  {
    id: 'drill-only-no-combat',
    provenanceURL: `${WIKI}/Digging_Bolt`,
    documentedArchetype: 'DIGGING',
    documentedKeyBehavior: 'a pure digging bolt — terrain work, ~0 combat value (must demote on DAMAGE)',
    spellIds: ['DIGGER'],
    alwaysCast: [],
    stats: chassis(),
    documented: { projectilesPerCast: 1, hasTrigger: false },
  },

  // ---- ENABLER: chainsaw reach cases (combat demotion + payload reach) -----------
  {
    id: 'chainsaw-only',
    provenanceURL: `${WIKI}/Chainsaw`,
    documentedArchetype: 'DIGGING',
    documentedKeyBehavior: 'a melee enabler used point-blank — close range, not a ranged damage wand (must demote on DAMAGE)',
    spellIds: ['CHAINSAW'],
    alwaysCast: [],
    stats: chassis(),
  },
  {
    id: 'chainsaw-plus-ranged-payload',
    provenanceURL: `${WIKI}/Chainsaw`,
    documentedArchetype: 'DAMAGE',
    documentedKeyBehavior: 'the enabler paired with a ranged payload that actually reaches the target',
    spellIds: ['CHAINSAW', 'HEAVY_BULLET'],
    alwaysCast: [],
    stats: chassis(),
  },
]
