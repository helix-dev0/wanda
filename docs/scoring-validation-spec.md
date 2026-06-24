# Scoring Validation & Stack Decision

**Status:** research + decision doc (2026-06-24). Companion to
[`scoring-rebuild-spec.md`](./scoring-rebuild-spec.md). Answers two recurring maintainer
questions:
1. Should the engine / simulator / scorer move off **TypeScript** to a "real API" backend?
2. How do we **test & simulate** to improve scoring reliability and the system's understanding
   of *good* wands — including using **builds shared online** — *without* breaking the
   autonomous-quality invariant (CLAUDE.md #9: never fit to human labels)?

---

## 1. Stack decision — stay TypeScript, local-first (settled, with reasoning)

**Decision: do NOT rewrite the engine/simulator/scorer in another language or behind a backend
service.** The *productive* version of "a real API" is a **data interface** — an importer for
shared wand builds + a validation harness — built in the existing TS, not a backend rewrite.

Grounded in invariants #4 / #9 and in **every bug we have actually hit**:

- **The simulator is a vendored, faithful port of Noita's `gun.lua`** (salinecitrine `calc/`).
  Invariant #4 is *reuse, don't rebuild*. Re-implementing it in Rust/Python = re-deriving the
  simulator from scratch = re-incurring its 34+ known cast-mechanic edge cases. Huge correctness
  risk, zero correctness gain.
- **Correctness is a MODEL problem, not a language problem.** Every scoring bug found by driving
  the live app — SPAM-with-no-damage, payload-blind DPS, fast-wand-reads-0, burst inflation,
  reach-by-distance — was a *fidelity / modeling* error, fixable in TS. None was a TS limitation.
  Invariant #9: "correctness comes from the model + meta grounding, not the language."
- **The scorer must sit next to the sim.** It walks the engine's live cast tree
  (`WandShot` / `Projectile.trigger`) directly. A network/language split adds serialization + a
  drift surface for nothing.
- **Performance is not the bottleneck.** The exhaustive search measured ~39 ms / 274 sims;
  generation already runs off-thread in a worker. A server would *add* latency, infra, and a
  privacy cost — the app is deliberately **local-first** (the mod reads your game; nothing leaves
  your machine). Cross-platform packaging (Tauri v2) already works.

**When a backend / other language WOULD be justified** (none apply today): shared multi-user
state; a library available only off-JS; or a 100×-faster search need. If that ever arises, the
move is a **separate engine cross-validated against the vendored TS sim** (differential testing) —
never a casual rewrite that abandons the validated port. The harness in §3–4 is exactly what would
make such a port safe later.

→ The maintainer's instinct that we need **more rigor** is right; the lever is **validation + a
real-build corpus**, not the backend language. (See the `engine-meta-fidelity` memory.)

---

## 2. The hard constraint — autonomous quality (#9)

We must **not** use community tier ratings ("this wand is S-tier") as fit targets. That is exactly
the forbidden label-fitting. So **builds shared online cannot be a labeled golden corpus.**

The reconciliation: online builds are a **simulation-fidelity + meta-reasoning test corpus**,
validated *only* by truths derivable from the **sim + cited meta** — never by an absolute human
tier. We let the community/wiki *describe mechanics and purpose*; we never copy their *tier*.

---

## 3. The validation strategy — three layers, all #9-compliant

### Layer A — Simulation fidelity (the objective engine layer)
Ingest documented builds and check our sim reproduces their **documented mechanics**: cast
sequence, projectile counts, trigger/payload structure, mana drain/sustain. The build's *described
behavior* is the oracle (a mechanic, not a tier).
- **Why it's tractable:** our engine *is* the salinecitrine sim (vendored), and the salinecitrine
  web simulator + the wiki share builds as **comma-separated spell IDs** — the same IDs we use — so
  importing is direct, and the simulator's own evaluation tree is an independent cross-check.
- **Why it matters:** our current fixtures are all fresh-run ≤117-DPS starters. Real shared builds
  (deep trigger chains, multicast stacks, recursion, exotic spells) exercise the sim far past that —
  exactly where the burst / reach / payload-class bugs hide. Raises **reliability** regardless of scoring.

### Layer B — Archetype routing (the verdict's *shape*, not its magnitude)
A build the guide *describes by purpose* should be routed to the matching archetype: "max
single-target DPS" → tops DAMAGE; "horde/crowd clear" → AOE; "digging/mobility" → MOBILITY;
"infinite / rapid-fire" → SPAM; "tank/shield" → DEFENSIVE. Assert it lands in its **meta-correct
archetype with sane metrics** — *not* that it hits a specific score. A **meta-expert agent reasoning
from the wiki** (the #9 validation method) judges soundness and flags gaps the orderings miss.

### Layer C — Differential / ordering tests (relative meta-truths)
The meta knows mechanical orderings *independent of any tier label*. Encode each as "A scores higher
than B on dimension D **because** \<cited mechanic\>":
- trigger→heavy-payload **>** bare carrier (DAMAGE) — payload delivery.
- mana-sustainable spammer **>** identical stalling one (SPAM) — mana is a hard constraint.
- tight BURST **>** wide SCATTER at equal raw DPS (DAMAGE single-target) — spread.
- enabler+ranged-payload **>** enabler-only (DAMAGE) — the chainsaw/drill reach cases.
- modifiers→multicast broadcast **>** bare multicast (DAMAGE) — the multiplier engine.
- crit-stacked **>** un-crit (DAMAGE) — multiplicative crit.

Robust + #9-compliant (no absolute labels — only "X beats Y because the mechanic says so") and a
direct pin on scoring **reliability**. Several already exist as unit tests; the corpus adds
real-build orderings.

---

## 4. Implementation plan (the harness — phased, all [APP] fixture-testable)

1. **Importer** — parse the salinecitrine simulator / wiki share format (spell-ID list + wand
   stats) → our `Snapshot` schema. Direct (shared IDs).
2. **Corpus** — encode N documented builds under `src/data/corpus/`, each tagged with
   `{ provenance URL, documented purpose/archetype, documented key behavior/metrics }` (the oracle).
   Kept distinct from the synthetic test fixtures.
3. **Layer-A tests** — assert the sim reproduces each build's documented projectile count / cast
   structure / mana behavior.
4. **Layer-B/C tests** — archetype-routing + ordering assertions over the corpus.
5. **Meta-expert validation pass** — an agent that reasons from the wiki per build → "is the
   scorer's verdict sound?", surfacing gaps (the autonomous validator #9 prescribes; the role the
   live-driving sessions have played manually).
6. *(optional, human-in-loop)* **Differential vs the real game** — paste corpus builds into the
   real game / simulator and compare cast trees (scales the M3-T5 spot-check).

---

## 5. How this unblocks the open items
- **REF / MANA_PENALTY calibration** (blocked on a real-wand corpus): the corpus spans the real
  power curve. Ground REF in the **meta's own power language** (the guides describe early / strong /
  elite power bands + enemy-HP curves — meta *knowledge*, not per-wand human tiers) and validate the
  bands by reasoning. This is the #9-compliant calibration: constants grounded in cited meta facts,
  output checked against meta knowledge.
- **Absolute-vs-relative** (the Chain-Bolt case, 2026-06-24): the corpus shows where a player's held
  wands sit on the absolute curve, informing whether to add a "best of your current pool" relative
  highlight (an early wand can be the player's best yet correctly modest on the absolute band).

## 6. Non-goals
- No community tier labels as fit targets (#9).
- No backend rewrite (§1).
- Not blocked on the live game — Layers A–C run on fixtures/corpus; Phase 6 is optional.

## Sources
- Noita Wand Simulator (salinecitrine; our vendored engine's origin), share = spell-ID list:
  https://noita-wand-simulator.salinecitrine.com/ · https://github.com/salinecitrine/noita-wand-simulator
- Wiki tool + wand template (share/import format): https://noita.wiki.gg/wiki/Tool:_Noita_Wand_Simulator ·
  https://noita.wiki.gg/wiki/Template:Wand2
- Expert Guide series (documented builds + purposes) — noita.wiki.gg (see `noita-meta-sources` memory).
