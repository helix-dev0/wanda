# Scoring Model v2 — SPEC (TTK-grounded, autonomous-quality)

> **Status: APPROVED spec (2026-06-25), interview-grounded.** SPEC ONLY — implementation is a
> SEPARATE session (spec → review → implement discipline). Supersedes `scoring-rebuild-spec.md`
> (v1). Companions: `scoring-validation-spec.md` (the validation harness, still authoritative) and
> `scoring-rebuild-v2-kickoff.md` (the seed this spec was grown from).

---

## 1. Context — why this rebuild

The patched heuristic scorer is **structurally untrusted** (maintainer verdict 2026-06-24). Many
individually-correct, fresh-context-reviewed slice-fixes shipped (payload damage, crit,
reload-overlap, reach-by-weapon-kind, mana-bounded burst, digging-excluded-from-combat) — yet the
**overall ranking still doesn't match ground truth.** Each fix was locally right; the whole stayed
wrong. That pattern is the signature of a **model** problem, not another isolated bug — so we
rebuild the model, not the constants.

**Scope of the rebuild (locked, invariant #4):** KEEP the vendored simulator (`src/engine/`, the
faithful port of Noita's `gun.lua`). Rebuild ONLY the two layers on top:
1. the sim→metrics **interpretation** (`src/sim/metrics.ts`), and
2. the **scorer** (`src/analysis/`).

**Invariant #9 is binding throughout:** the app determines quality autonomously. **No human tier
labels, no golden-tier corpus, no fitting scores to ratings.** Constants are grounded in **cited
meta facts** (enemy-HP curves, wiki guide thresholds, the multiplicative-stacking math); the
output is validated against meta **knowledge** (a meta-expert reasoning from the wiki). The
maintainer validates; the maintainer never labels.

---

## 2. Locked decisions (this interview, 2026-06-25)

| # | Decision | Choice |
|---|---|---|
| 1 | **Damage unit** | **Expected time-to-kill (TTK) vs wiki-grounded reference enemies.** Kills the guessed `REF` constants — bands come from real enemy HP. Discrete hits-to-kill captures overkill/breakpoints. |
| 2 | **Output frame** | **Absolute power curve only.** No separate pool-relative scoring engine. The Chain-Bolt fix is *metric correctness* (honest TTK), not a relative re-frame. "Your best right now" = the top of *your* wands on the absolute list. |
| 3 | **Archetypes** | **DAMAGE / AOE / SPAM** (combat, TTK-scored, **overlap is intentional**) **+ first-class DIGGING** (simulator-scored *and* generation-first). **MOBILITY → a simple capability flag.** **DEFENSIVE → dropped** ("defense isn't really a wand thing"). |
| 4 | **Metric fidelity** | **MODEL: multi-hit / pierce / bounce** and **DoT magnitude (fire/poison/toxic).** **DEFER: velocity/kinetic** (sign-inverted anti-proxy). **APPROXIMATE: trigger-connect** (assume connect + a reliability *note*, never an un-grounded probability number). |
| 5 | **Validation bar** | **Full 3-layer harness + meta-expert sign-off** over a **15–20-build corpus**. No human labels. This is THE gate (§7). |
| 6 | **Migration** | **Replace in place** — but only once the harness (built first, as the red target) is green. No parallel runtime A/B; the corpus tests are the regression net. |
| 7 | **Tech stack** | **TypeScript, in-process** — scorer/metrics stay next to the vendored engine they walk. Settled `scoring-validation-spec.md §1`; rationale §6 below. |

---

## 3. Structural diagnosis — the three failure modes to NOT repeat

1. **No ground-truth loop.** The real-build corpus was never built; the scorer was only "validated"
   against 3 tiny fixtures + manual live spot-checks. Every fix was locally correct yet the whole
   kept mis-ranking, because *nothing checked the whole*. → §7 makes the corpus + harness
   first-class and mandatory (the v1 rebuild failed precisely because this never existed).
2. **Abstract units + guessed thresholds.** `score = sat(metric × factors, REF)` with provisional
   `REF` constants (`sustainedDps=300`, `spreadDeg=20`, `projPerSec=8`, `projPerCycle=12` — several
   bare numbers, no cited source). Nothing anchored "good" to anything real, so early wands
   collapsed to C/D and "good" had no meaning. → §5 replaces the abstract unit with **TTK vs real
   enemy HP**.
3. **Lossy metrics feeding the scorer.** `src/sim/metrics.ts` is single-hit (`bouncesLeft` read by
   the engine, never multiplied), assumes a trigger payload *always connects*, models DoT as a bare
   capability flag (`appliesDot`), velocity deferred. Errors compounded *before* scoring. → §5.4–5.5
   close the gaps that feed TTK (pierce/multi-hit, DoT magnitude).

---

## 4. What stays vs what is rebuilt

**Stays (do not touch):** `src/engine/` (vendored sim, invariant #4); the cast-tree contract the
scorer walks (`WandShot`, `Projectile.trigger?: WandShot` recursion, `castState`, `manaDrain`); the
self-danger veto (perk-aware, first-class — `src/analysis/selfDanger.ts`); the mana/cycle timing
model (`cycleFrames` reload-overlap is correct and meta-grounded); the snapshot/spell-DB schemas.

**Rebuilt:** the metric definitions in `src/sim/metrics.ts` (DPS-blend → TTK-oriented per-hit
model + pierce + DoT magnitude); the scorer `src/analysis/archetypes.ts` (per-archetype `sat()`
blend + `REF` constants → TTK bands per reference scenario); the archetype set (drop DEFENSIVE,
demote MOBILITY to a flag, promote DIGGING); the generation/search coupling to the new score
interface (`src/generation/`).

---

## 5. The v2 model

### 5.1 Unit — expected time-to-kill (TTK)

A wand's combat power is **the expected seconds to kill a reference enemy**, computed from the
simulated cast cycle. Lower TTK ⇒ higher score. This replaces `sat(effectiveDPS, 300)`.

**Definition (the invariant the implementation must satisfy):** simulate the wand's cast cycle and
accumulate delivered damage (projectile + explosion + DoT, per the per-hit model §5.4) against the
reference enemy's HP, respecting **cycle timing + mana stalls** (reuse the existing mana-bounded
cycle), until cumulative damage ≥ HP. TTK is that time.

Two grounded rules that fall out of the meta and MUST hold:

- **Overkill saturates (TTK has a one-cast floor).** A wand that one-shots the reference enemy is
  "as good as it gets" *for that enemy* — extra damage is wasted. This is intrinsic to TTK against a
  *fixed*-HP target and directly answers the meta's "extreme damage is overkill" reality (end-game
  builds reach quintillions of DPS, dwarfing every enemy's HP of 9–3500). The old `sat()` curve
  faked this with an asymptote; TTK captures it honestly via the discrete one-shot floor.
- **DoT is a softener, not a finisher (base game).** Toxic/fire/poison stains tick **~2% of MAX HP
  per second** and **floor at ~2% HP** — "you will never actually be killed directly from stain
  damage." So DoT accelerates TTK by knocking a high-HP target down toward ~2% HP, but the
  *projectile* damage must land the kill. Model DoT as a parallel damage stream **capped at the
  stain floor**, not as a lone finisher. (NG+ poison tripling → 54%/s is **out of scope**, flagged.)

### 5.2 Reference enemies (the anchors) — CITED, absolute, fixed

Scoring is **absolute** (decision 2) against a **fixed** reference set (the snapshot carries no
biome/depth — verified `src/schema/snapshot.ts` — so stage-aware references are not feasible today;
see deferral below). HP values are the wiki's internal values (the in-game UI shows ×25 for bosses).

| Role | Enemy | HP | Source |
|---|---|---|---|
| **Weak mob** (swarm unit) | Haulikkohiisi (Shotgunner) | **22.5** (9 for the Mines-floor variant) | noita.wiki.gg/wiki/Haulikkohiisi |
| **Mid bruiser** (single tough target) | Isohiisi (Big Hiisi) | **150** (300 in Underground Jungle — use normal) | noita.wiki.gg/wiki/Isohiisi |
| **Boss sponge** (fixed) | **Ylialkemisti** (High Alchemist) | **1000** (fixed) | noita.wiki.gg/wiki/Ylialkemisti |
| *(optional elite anchor)* | Jättimato (Giant Worm) | 3500 | noita.wiki.gg/wiki/Jättimato |

**Boss anchor must be fixed-HP.** Use **Ylialkemisti (1000)**, NOT Kolmisilmä — the final boss
scales with orbs/NG+ via `HP = 25·{46 + 2^(orbs+1.3) + 15.5·orbs}`, reaching trillions, so it is a
*scaling* reference only, never a fixed anchor (noita.wiki.gg/wiki/Kolmisilmä).

**Deferred — stage-aware references.** If the mod later emits run depth/biome (a Lua-mod change =
invariant #2 human-in-the-loop cost), the reference enemy could track the player's current biome,
making the absolute score biome-honest. Out of scope for v2; noted so the model leaves room.

### 5.3 Archetypes and their reference scenarios

Combat archetypes answer **different questions** against **different reference scenarios** — a great
wand legitimately tops several, which is correct (overlap is intentional, not a bug).

- **DAMAGE — single tough target.** TTK vs the **mid bruiser (Isohiisi 150)** and/or **boss
  (Ylialkemisti 1000)**. Single-target, so accuracy matters: keep the spread→on-target factor and
  the reach-by-weapon-kind factor (a close-range contact tool is not a ranged single-target weapon).
  Burst folds into TTK naturally (a fast kill = low TTK) — no separate inflatable burst term.
- **AOE — clear a swarm.** Time to clear a reference **swarm of weak mobs (Haulikkohiisi 22.5)**.
  This is where **pierce/multi-hit + explosion coverage** are load-bearing: one cast kills
  `min(coverage, remaining)` mobs, where coverage = explosion-radius mobs + penetrating-projectile
  mobs (§5.4). Spread/range do NOT gate AOE (a blast clears a cluster regardless).
- **SPAM — sustained, mana-holdable.** The **sustainable kill-rate** (weak mobs/sec you can fire
  *indefinitely*) against a stream. Hard-gated by mana sustainability — the metric collapses to the
  mana-sustainable fraction (reuse `manaRatio`/`manaSustainable`). Grounded in the rapid-fire guide:
  cast-rate is bounded by mana sustain, and ">10–20 casts/s is excellent for early-game wands"
  (noita.wiki.gg/wiki/Guide:_Rapid-Fire_Wands). SPAM ≈ "DAMAGE you can hold forever, spread-tolerant."
- **DIGGING — first-class (simulator-scored + generation-first).** NOT enemy-TTK. Metric =
  **dig capability × dig sustainability**:
  - *Capability* = the max material **durability tier (0–14)** the wand's dig spells can break.
    Top tier (14, digs everything incl. Cursed Rock): Luminous Drill, Plasma Cutter, Giga Nuke.
    Mid (10–12): Black/White Hole, Nuke, Digging Bolt/Blast (noita.wiki.gg/wiki/Digging).
  - *Sustainability* = can it dig **continuously / infinitely** (the mana/recharge/charge model). The
    *good, complex* diggers are exactly the hard-to-sustain ones: **Black Hole** digs Cursed Rock and
    leaves no terrain but costs **180 mana + 80 cast-delay** and is **not** made unlimited by the
    Unlimited Spells perk — an infinite black-hole wand needs Wand Refresh / Greek-letter (Alpha/
    Gamma) looping (noita.wiki.gg/wiki/Black_Hole). **Luminous Drill** (10 mana, −35 cast delay,
    dig-strength 14) trivially sustains but **destroys gold** — a poor miner (noita.wiki.gg/wiki/
    Luminous_Drill). The tool's job: surface/generate the **sustainable high-tier** dig combos.
  - *Secondary note:* gold-preservation (drill/explosion destroys nuggets) as a displayed caveat.
- **MOBILITY → capability flag.** Teleport wands are trivial to build; show "has dig / has mobility"
  as a flag on the card, not a tiered optimization target.
- **DEFENSIVE → dropped.** Not a meaningful wand property for this player.

**Tier ordering needs one scalar per archetype.** Each archetype reduces to a single scalar (TTK, or
kill-rate, or dig capability×sustainability) for the S–D ordering; the **rich sub-metrics are shown
alongside** (the spec's long-standing "never one collapsed score" — the scalar orders, the metrics
explain).

### 5.4 Per-hit damage model

Reuse the existing recursive cast-tree walk (`shotDamage` over `WandShot` → `Projectile` →
`Projectile.trigger`), which is already payload-aware and crit-correct. Keep:
- typed + untyped damage summed once each (`damage` + `damageByType`, skip `healing`); explosion as
  a separate HP application; **crit multiplies once** in `shotHP` (multiplicative — the dominant
  lever; crit = ×5 base, +×5 per +100%; multipliers stack multiplicatively and dominate flat adds —
  noita.wiki.gg/wiki/Critical_hit, /wiki/Template:Stacked_damage_multipliers).

**Add (decision 4):**
- **Multi-hit / pierce / bounce → enemies-hit count `N`.** There is **no single "penetration count"
  stat** — the wiki governs it with two projectile flags: **`penetrate_entities`** (penetrating =
  hits many bodies, *one hit each*, bounded by lifetime/range) and piercing (multi-hits the *same*
  body). Penetration is **innate to specific spells** (Black Hole, Chain Bolt, Holy Lance, …) and
  **cannot be added by any modifier**; piercing is added by **Piercing Shot** (−15 dmg, 140 mana)
  (noita.wiki.gg/wiki/Piercing_and_Penetrating, /wiki/Piercing_Shot). Bounces add traversal
  (Bouncing Spells perk: +3 bounces, +60 frames, per projectile). **Model `N` from flags + lifetime/
  bounces, not a count:** for AOE, a penetrating projectile hits up to the reference swarm's worth of
  mobs along its path; a non-penetrating one hits 1 (plus explosion coverage). For DAMAGE
  (single target), piercing's multi-hit-same-body raises per-target damage.
- **DoT magnitude.** Replace the `appliesDot` flag with a damage stream: **fire / poison / toxic
  stains tick ~2% MAX-HP/s, capped at the ~2% floor** (softener rule §5.1). Toxic = the "boss answer"
  (% of max HP scales where flat damage stalls). Sources: noita.wiki.gg/wiki/Toxic_Sludge,
  /wiki/Status_Effects.

### 5.5 Fidelity decisions + data prerequisites

| Gap | Decision | Notes / prerequisite |
|---|---|---|
| Multi-hit / pierce / bounce | **MODEL** | **DATA PREREQUISITE (verified):** the projectile table (`src/sim/data/projectileStats.generated.ts`) carries `bouncesLeft` but **not** `penetrate_entities` / `on_collision_die`. The table must be regenerated to include the penetrate/pierce flags before pierce can be modeled. |
| DoT magnitude (fire/poison/toxic) | **MODEL** | 2%/s softener, floored (§5.1). Stain duration: fire extinguished by liquid; exact sub-second tick interval is **UNVERIFIED** — treat as 2%/s, do not hard-code a frame tick. |
| Velocity / kinetic damage | **DEFER** | Sign-inverted anti-proxy — best builds *lower* `speed_multiplier` (Heavy/Accelerating Shot). A naive ×speed model is worse than none. Needs a projectile-table regen with air_friction/gravity/mass + impact distance. Unchanged from v1. |
| Trigger-connect probability | **APPROXIMATE** | Keep "assume the payload connects" (a trigger *is* a miniature wand you aim). Do NOT invent a connect-probability number (it would re-introduce exactly the un-grounded guessing TTK is killing). Instead surface a **reliability note** for shuffle wands (ordering breaks) and poorly-delivered payloads. |
| Digging capability data | **VERIFY at impl** | The DIGGING metric needs per-spell dig durability-tier / ray-energy. Confirm whether the projectile table carries it; if not, it's a second table-regen prerequisite. |

### 5.6 Bands → tiers (absolute, grounded)

Score is monotonic in 1/TTK (or kill-rate / dig-capability). S–D **band cutoffs are grounded in
enemy-HP + encounter cadence, NOT human wand tiers** (#9): "to not be overwhelmed you must kill enemy
X every ≤ t seconds" → that `t` is a band boundary. The **meta-expert validation pass (§7) sets and
sanity-checks the exact cutoffs** by reasoning from the wiki; the spec fixes the *method* and ships
**provisional** cutoffs, never asserted as final. One cited anchor exists already: SPAM's ">10–20
casts/s excellent early-game" (rapid-fire guide). This is the #9-compliant calibration: constants
grounded in cited meta facts, output checked against meta knowledge.

---

## 6. Tech stack — TypeScript, in-process (recorded so it stops recurring)

The metrics + scorer layer stays **TypeScript, in the app process**, beside the vendored engine.
Reasoning (settled `scoring-validation-spec.md §1`, re-confirmed this interview):
1. The scorer **walks the engine's in-memory cast tree** (`Projectile.trigger`, `castState`,
   `manaDrain`). A Python/backend scorer would serialize the tree across a process boundary on every
   evaluation — a drift surface + latency for zero correctness gain.
2. Avoiding that boundary means **re-porting `gun.lua`** to another language — re-deriving its 34+
   cast-mechanic edge cases, exactly what invariant #4 forbids; the project's biggest correctness risk.
3. **Local-first packaging (invariant #8):** Tauri desktop bundle, nothing leaves the machine, no
   server/firewall prompt. A backend means a per-OS runtime (Linux/Proton + Windows) or a localhost
   server — new cross-platform burden + the privacy cost deliberately designed out.
4. **Performance is not the bottleneck** (~39 ms / 274 sims; generation already off-thread).
Every scoring bug we hit was a **modeling** error fixed in TS, never a language limitation
(invariant #9). The rigor lever is the validation harness (§7), not the runtime. A different engine
would only ever be justified by shared multi-user state, an off-JS-only library, or a 100×-faster
search need — none apply; if one ever did, the move is a *separate* engine **differential-tested
against** the vendored TS sim, never a casual rewrite.

---

## 7. Validation plan + acceptance criteria (THE gate)

Implements `scoring-validation-spec.md` (still authoritative) as the **mandatory, first-class**
ground-truth loop v1 never had. **No human tier labels anywhere** — builds shared online are a
**fidelity + meta-reasoning** corpus, validated only by truths derivable from the sim + cited meta.

**Corpus:** **15–20** documented builds under `src/data/corpus/`, imported via the salinecitrine /
wiki **spell-ID share format** (our IDs — direct import), each tagged `{ provenance URL, documented
purpose/archetype, documented key behavior/metrics }` (the oracle is a *mechanic/purpose*, never a
tier). Must span the curve and exercise deep trigger chains / multicast stacks / recursion / exotic
spells (where the burst/reach/payload bugs hid).

**Three layers (all fixture-testable, #9-compliant):**
- **A — Simulation fidelity.** The sim reproduces each build's **documented mechanics** (cast
  sequence, projectile counts, trigger/payload structure, mana drain/sustain).
- **B — Archetype routing.** Each build lands in its **meta-correct archetype** with sane metrics
  ("max single-target" → tops DAMAGE; "horde clear" → AOE; "infinite/rapid" → SPAM; "digging" →
  DIGGING) — assert the *shape* of the verdict, not a specific score.
- **C — Differential / ordering.** Every cited mechanical ordering holds: trigger→heavy-payload **>**
  bare carrier; mana-sustainable spammer **>** identical stalling one; tight BURST **>** wide SCATTER
  at equal raw DPS; enabler+ranged-payload **>** enabler-only; modifiers→multicast broadcast **>**
  bare multicast; crit-stacked **>** un-crit. ("A > B because <cited mechanic>" — no absolute labels.)

**Meta-expert sign-off:** a fresh agent reasoning **from the wiki** judges each corpus build's
verdict sound and surfaces gaps the orderings miss (the autonomous validator #9 prescribes; the role
the manual live-driving sessions have played).

**Acceptance bar — the rebuilt scorer is "TRUSTED" only when ALL hold:**
1. Layer A green for every corpus build (sim reproduces documented mechanics).
2. Layer B green: every corpus build routes to its meta-correct archetype with sane metrics.
3. Layer C green: all cited ordering tests pass.
4. Meta-expert pass: no material soundness gaps across the corpus.
5. **Maintainer ground-truth mechanic cases hold** (these are mechanic truths, not labels): the
   Chain-Bolt wand reads an *honest* TTK (low-but-correct is acceptable); drill-only / chainsaw-only
   demoted on combat; a real held wand ≥ an unsustainable nova; a sustainable high-tier digger tops
   DIGGING.
Only then does the replacement (§8) land. Failing any → not trusted, keep iterating.

---

## 8. Migration — replace in place, harness-gated

No parallel runtime A/B (decision 6). Sequence (TDD red→green; the harness is the safety net):
1. **Author the validation harness + corpus first** (§7) — the **red** target.
2. **Table-regen prerequisite** — add `penetrate_entities`/`on_collision_die` (+ verify dig-tier
   fields) to the generated projectile table (§5.5).
3. **Rebuild `src/sim/metrics.ts`** → the per-hit + pierce + DoT model feeding TTK (§5.4).
4. **Rebuild `src/analysis/`** → TTK bands per reference scenario for DAMAGE/AOE/SPAM/DIGGING;
   MOBILITY as a flag; **delete** the old `sat()`/`REF` blend and DEFENSIVE.
5. **Re-wire `src/generation/`** to the new score interface (today it reads
   `analysis.scores[archetype].score` directly — `generate.ts`, `suggestions.ts`).
6. **Green the harness + meta-expert sign-off → remove old code.** Replacement is complete only at
   the §7 acceptance bar.

Each slice atomic, TDD, fresh-context-reviewed (writer doesn't grade its own work).

---

## 9. Grounding citations (and flagged UNVERIFIED items)

All from **noita.wiki.gg** (the maintained wiki) + the vendored engine's actual code. Reference
enemies, DoT, pierce, digging, crit/stacking, and rapid-fire bands are cited inline above. **Items
the implementation MUST confirm before relying on them** (do not hard-code without re-verifying):
1. **DoT tick interval** — all three resolve to ~2% max HP/s; the literal sub-second "tick" frame
   count is not numerically stated. Treat as 2%/s.
2. **Fire *material* contact damage** (standing in fire) vs the burning *stain* — only the stain's
   2%/s is cited; flat per-contact fire damage is engine-internal, UNVERIFIED.
3. **Penetration count `N`** has no single stat — model from flags + lifetime (the ~60×/s piercing
   figure came from a page marked "Todo").
4. **"×1.25 damage per projectile in hand"** is cited only in the **Hungry Ghost** context, NOT as a
   universal multicast multiplier — verify against the gun-mechanics source before any generic use.
5. **Boss anchor** — use fixed-HP **Ylialkemisti (1000)**; Kolmisilmä scales to trillions.
6. **Bounce-modifier exact counts** (Explosive/Sparkly Bounce "+1") came from search summaries —
   re-verify on-page if bounce-N matters to scoring. (Bouncing Spells perk "+3/+60 per projectile"
   was page-confirmed.)

---

## 10. Out of scope / non-goals

- No community **tier labels** as fit targets (#9). No golden-tier corpus, no "tell it the tier."
- No backend rewrite / language change (§6). No moving the vendored engine (#4).
- **Velocity/kinetic damage** stays deferred (§5.5). **NG+ DoT tripling** out of scope.
- **Stage-aware** reference enemies deferred (snapshot has no biome/depth).
- No mod changes required by the model itself (the table-regen is a build-time data step, not a
  runtime Lua change) — except the deferred stage-awareness, which would need the mod.
- **Self-danger veto unchanged** (already first-class, perk-aware, validated end-to-end).

---

## 11. Session boundary

This session ends at an **approved spec**. Per spec→review→implement discipline:
- **Next:** a **fresh review session** — fresh-context subagent reviews this spec against the
  kickoff + `scoring-validation-spec.md` + invariant #9, and the maintainer validates the reference
  enemies / provisional bands.
- **Then:** a **separate implementation session** — harness-first, TDD, corpus-validated,
  fresh-context-reviewed, replace-in-place per §8.

## Verification (how the eventual implementation is proven — not done this session)

- **Automated:** `npm test` green including the new 3-layer corpus harness (§7); typecheck/lint clean.
- **Meta-expert pass:** agent reasoning from the wiki signs off the corpus verdicts (§7.4).
- **Live (human-in-the-loop):** drive the real app on a captured run; confirm the §7.5 ground-truth
  mechanic cases hold against the maintainer's judgment. "Seems right" is never sufficient — show
  passing corpus tests + the meta-expert sign-off.
