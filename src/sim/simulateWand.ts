// M3-T2 — the sim layer: turn a snapshot wand into a real cast result.
//
// We do NOT translate our metadata-only spell_db.json dump into behavior. The
// behavior lives in the vendored engine's imperative `action:(c)=>{}` fns
// (src/engine/__generated__/gun_actions.ts); we map spell ids → those built-in
// Actions via getActionById and run clickWand. See docs/plan.md (M3).

import { clickWand } from '../engine/eval/clickWand'
import { getActionById } from '../engine/eval/util'
import { setEngineConfig } from '../engine/config'
import type { WandShot } from '../engine/eval/types'
import type { Action, Gun } from '../engine/extra/types'
import type { Wand } from '../schema/snapshot'

export interface SimOptions {
  /** Mana pool to start the cycle with. Default: the wand's current `stats.mana`. */
  mana?: number
  /** Override cast delay (frames). Default: `stats.castDelay`. */
  castDelay?: number
  /** Keep firing shots until the deck reloads (capped at 10 iterations). Default true. */
  fireUntilReload?: boolean
  /** Stop when an action triggers RESET (refresh). Default true. */
  endOnRefresh?: boolean
  /** Deterministic RNG seeds (matters for shuffle wands). Default {0, 0}. */
  seed?: { worldSeed?: number; frameNumber?: number }
}

export interface SimResult {
  shots: WandShot[]
  /** Wand reload time in frames (the engine's 2nd return value); undefined if no reload occurred. */
  reloadTime: number | undefined
  /** True if the engine hit its 10-iteration cap — results are a truncated lower bound. */
  hitIterationLimit: boolean
  /**
   * True when the simulation is not a faithful reproduction of the real wand:
   * some spell id was missing from the engine table (modded), or the wand has
   * always-cast spells (which clickWand has no real path for — see below).
   */
  approximate: boolean
  /** action_ids present on the wand but absent from the engine's built-in table (modded spells). */
  missingSpells: string[]
}

// Map snapshot wand stats → the engine's Gun (project-lead mapping; see plan).
// Note: `deck_capacity` is informational inside clickWand — it never bounds the
// deck we build (_add_card_to_deck always pushes). Mapped for fidelity, not gating.
function toGun(wand: Wand): Gun {
  return {
    actions_per_round: wand.stats.spellsPerCast,
    shuffle_deck_when_empty: wand.stats.shuffle,
    reload_time: wand.stats.rechargeTime,
    deck_capacity: wand.stats.capacity,
  }
}

// Resolve spell ids → Action objects. getActionById THROWS on unknown/modded
// ids (engine util.ts:12); we catch per-id, collect the misses, and skip them —
// the resulting sim is a lower bound on the real wand, hence `approximate`.
// null slots are skipped (clickWand filters them anyway).
function resolveSpells(ids: readonly (string | null)[], missing: string[]): Action[] {
  const out: Action[] = []
  for (const id of ids) {
    if (id == null) continue
    try {
      out.push(getActionById(id))
    } catch {
      missing.push(id)
    }
  }
  return out
}

/**
 * Simulate clicking the player's current wand from a snapshot.
 *
 * always_cast spells are PREPENDED to the deck. clickWand has no real always-cast
 * path (it only iterates the `spells` array into the deck), so this is an
 * approximation, not true always-cast semantics — any wand with always_cast is
 * flagged `approximate`. No fixture exercises always_cast yet (revisit at M1).
 */
export function simulateWand(wand: Wand, opts?: SimOptions): SimResult {
  setEngineConfig({
    worldSeed: opts?.seed?.worldSeed ?? 0,
    frameNumber: opts?.seed?.frameNumber ?? 0,
  })

  const missingSpells: string[] = []
  const deckIds = [...wand.always_cast, ...wand.spells]
  const spells = resolveSpells(deckIds, missingSpells)

  const mana = opts?.mana ?? wand.stats.mana
  const castDelay = opts?.castDelay ?? wand.stats.castDelay

  const [shots, reloadTime, hitIterationLimit] = clickWand(
    toGun(wand),
    spells,
    mana,
    castDelay,
    opts?.fireUntilReload ?? true,
    opts?.endOnRefresh ?? true,
  )

  return {
    shots,
    reloadTime,
    hitIterationLimit,
    approximate: missingSpells.length > 0 || wand.always_cast.length > 0,
    missingSpells,
  }
}
