# Scoring Rebuild v2 — kickoff / seed for a fresh SPEC session

**Status:** SEED for an interview-grounded spec (not the spec yet). Created 2026-06-24 after the
maintainer judged the patched heuristic scorer still untrustworthy. Read this + `progress.md`
("SCORING NOT YET TRUSTED") + `scoring-validation-spec.md` + the `engine-meta-fidelity` /
`noita-meta-sources` memories before writing the spec. **Do the spec in a FRESH session** (this one
is context-heavy); this doc is the handoff so that session starts grounded.

## Decisions locked (maintainer interview, 2026-06-24)
1. **Rebuild the whole MODEL**, not more constants. The hand-tuned per-archetype heuristic is the
   problem, not an isolated bug.
2. **Keep the vendored simulator** (salinecitrine `src/engine`, invariant #4) — rebuild the **layer
   on top**: the DPS/metrics interpretation (`src/sim/metrics.ts`) + the scorer (`src/analysis`). The
   "re-think how we USE the simulator" concern lives here.
3. **Fresh SPEC first** → review → implement in a separate session (spec/plan/impl discipline).
4. Standing invariants still hold: **#9 autonomous quality — NO human tier labels / no fitting to
   ratings**; tier-list-per-archetype output (confirm/revisit in the spec); performance is hard-required.

## Why the current scorer failed (structural diagnosis — the thing to NOT repeat)
- **No ground-truth loop.** #9 forbids fitting to human labels, and the real-build corpus was never
  built — so the scorer was only ever "validated" against 3 tiny fixtures + live spot-checks. Every
  fix was locally correct yet the whole kept mis-ranking, because nothing checked the whole.
- **Abstract units + guessed thresholds.** Scores are `sat(metric × factors, REF)` blends with
  PROVISIONAL `REF` constants (e.g. `sustainedDps=300`) and hand-picked weights (0.7/0.3). Nothing
  anchors them to anything real → early wands all collapse to C/D, "good" has no meaning.
- **Lossy metrics feeding it.** The sim→metrics layer is single-hit, optimistic "trigger always
  connects," no pierce/bounce/multi-hit, no velocity damage, DoT only a capability flag. Errors
  compound before scoring starts. (This is the "use the simulator better" half.)

## Candidate model DIRECTIONS to evaluate in the spec (not yet decided — for the interview)
1. **Grounded unit = time-to-kill (TTK) vs REFERENCE enemies.** Replace abstract DPS→sat→tier with
   "expected seconds to kill" against a small set of reference targets whose HP comes from the wiki
   (a weak mob, a mid-game tank, a boss-tier HP). DAMAGE = TTK on a single tough target; AOE = time
   to clear a swarm; SPAM/sustain = can you hold it (mana). Tiers map to TTK bands grounded in
   enemy-HP **meta knowledge** (which is #9-legal — it's cited game data, not a human wand label).
   This makes a score MEAN something and kills the guessed REFs.
2. **Absolute + relative hybrid output.** Show where a wand sits on the absolute power curve AND rank
   within the player's CURRENT pool, so "your best wand right now" surfaces even when it's a modest
   early wand (resolves the Chain-Bolt "it's my best but reads D" tension).
3. **Validation loop is first-class + mandatory.** The shared-build corpus (`scoring-validation-spec.md`:
   import real builds via the salinecitrine spell-ID share format → check sim reproduces documented
   mechanics + meta-ordering holds, NO tier labels) is the ground-truth the model is validated against.
   The model isn't "done" until it passes the corpus orderings + a meta-expert sanity pass.
4. **Close the lossy-metric gaps** (the sim-interpretation rebuild): multi-hit / pierce / bounce (a
   projectile hits N enemies), trigger-connect probability, real DoT magnitude, and the deferred
   velocity-damage model. Decide which to model vs accept-as-approximate.

## Open decisions for the spec interview
- Reference enemies + HP curve: which enemies/stages anchor TTK? (source-ground in the wiki.)
- Output: absolute, relative, or the hybrid (2)? Keep the 5 archetypes (DAMAGE/SPAM/AOE/MOBILITY/
  DEFENSIVE) or restructure?
- Metric fidelity: which of multi-hit / velocity / DoT / trigger-probability are in scope for v2?
- Validation acceptance criteria: how many corpus builds, which orderings, what pass bar before the
  rebuilt scorer is "trusted"?
- Migration: build v2 alongside the current scorer (A/B compare on the corpus) then switch, vs replace.

## How to start
Open a fresh session, run `/spec` (interview-first), point it at this doc. Goal of that session: a
`scoring-model-v2-spec.md` with the model decided, the validation plan, and acceptance criteria —
then a SEPARATE session implements it (TDD, corpus-validated, fresh-context-reviewed).
