# Scoring & Simulation Grounding Spec

**Status:** ✅ Tier 0 + the crit hole (Tier 1) DONE + fresh-context-reviewed (2026-06-22, 316 tests
green, browser-validated). Remaining Tier 1–3 items specced below for follow-on.
**Why this exists:** the app's plumbing + cast simulation are sound, but the **scoring/analysis
model is blind to the real Noita meta**, so "best build" / the tier list / suggestions can't be
trusted. This spec grounds the scorer in real mechanics (cited) and stages the fix so the
correctness-critical, *verifiable* changes land first and the risky/calibration parts are gated on
verification + real data. Engine fidelity is the heart of this project — never guess; verify against
the forked engine's real types and validate against real captured wands (`npm run record`).

Sources: `noita.wiki.gg` guides (Wand Mechanics, Rapid-Fire Wands, Critical Hit, Expert Guide: High
Damage Wands, Chainsaw, Add Trigger, Status Effects) + the salinecitrine reference simulator (our
fork). See the memory `noita-meta-sources`.

## 1. The real meta — what makes a wand strong (ranked, cited)

1. **Damage is delivered through PAYLOADS, not top-level shots.** A trigger/timer/death projectile is
   "a miniature wand" that casts its payload on impact; the high-damage meta separates cheap feed
   projectiles from a heavy payload detonated on contact. *(Guide: Wand Mechanics; Expert Guide: High
   Damage Wands.)*
2. **Damage multipliers stack MULTIPLICATIVELY and dominate flat adds.** Crit ×5 base (scales per
   +100%), velocity ×up-to-200; flat adds (Damage Plus +10, Heavy Shot +43.75) are minor by
   comparison. *(Critical Hit; Stacked damage multipliers.)*
3. **Add-Trigger wrapping + multicast is the multiplier engine** — modifiers before a multicast apply
   to all drawn projectiles for one cost; Add Trigger lets a cast wrap so modifiers apply many times.
4. **Cast-delay + recharge minimization gates throughput** (0/0 → ~60 casts/s). Chainsaw / negative-
   recharge spells (Luminous Drill, Digging Bolt) are the *enablers*.
5. **Mana economy is a hard constraint; overkill is a defect.** A spammer's value is *sustained
   effective damage you can pay for*, **not raw projectile count**. *(Rapid-Fire guide: "high
   projectiles/sec alone is insufficient.")*
6. **A flat +bonus disproportionately helps weak spells** — the cheap-shot × right-modifier *pairing*
   is the unit of value, not the shot alone.
7. **Range / lifetime / speed convert raw damage to usable damage** — a short-lived beam that can't
   reach isn't high-DPS in practice.
8. **Status/DoT is %-max-HP** — the answer to tanky/boss targets a raw-HP model can't see.
9. **AoE = blast *damage* + radius; digging blasts are not lethal AoE.** Mobility/digging are run
   utility, not damage.
10. **The reference sim deliberately does NOT compute DPS** — so a *payload-aware* damage scorer is
    genuine added value, not reinventing the engine.

## 2. Where our engine diverges (the holes)

> **Found + fixed 2026-06-23 (driving a real fast wand):** ① **fast wands scored 0 DPS** —
> `metrics.ts` divided by a `cycleFrames=0` (cast delay ≤0 + zeroed recharge), so the BEST wands
> read 0 and suggestions went unstable. Fixed by flooring per-shot frames at 1 (Noita's 60-casts/s
> cap; wiki: "a negative cast delay is treated as 1 frame"). Goldens unchanged, engine untouched.
> ② **self-danger missed wide-blast lobbed explosives** (Dynamite) — fixed via a `LARGE_BLAST_RADIUS`
> rule. ③ **reload now OVERLAPs cast-delay (FIXED 2026-06-22)** — Noita runs cast delay + recharge
> simultaneously and recharge starts only at deck-empty, so it overlaps ONLY the final cast delay;
> cycle is now `Σd_{1..S-1} + max(d_S, max(0,R))` (was additive `Σd + R`). 4 goldens re-derived
> (50→39, 69→41, 58→52, edge 30→20), `burstDps` invariant, validated on a real BOUNCY_ORB×3 capture
> (+32% sustained DPS), fresh-context-reviewed. **Still open:** ④ **velocity/`speed_multiplier`
> damage** — DEFERRED with rationale: `speed_multiplier` (default 1.0, clamped [0,20]) is an
> *anti-proxy* for the real impact-speed bonus (the best velocity builds — Heavy/Accelerating Shot —
> LOWER it), which needs flight physics (drag/gravity/mass/distance) we don't extract and applies to
> only 5 vanilla projectiles. A static `×speed_multiplier` model would be sign-inverted → worse than
> none. (noita.wiki.gg/wiki/Spells_With_Damage_Scaled_By_Speed.)

- **`sim/metrics.ts` `shotDamage`** sums only top-level `shot.projectiles` → **payload damage
  invisible** (Principle 1). Our forked engine already holds the payload at `Projectile.trigger?:
  WandShot` (recursive, built in `engine/eval/clickWand.ts:158-173`) — we just never walk it.
- **Additive only** (`(base + damage_projectile_add) × 25`) → no crit/velocity multiplier (Principle 2).
- **Single-hit, no range/lifetime/pierce/bounce, no status** (Principles 7, 8).
- **`archetypes.ts` `scoreSpam = sat(projectilesPerSecond, 8)`** — **no damage term** (Principle 5).
  A 0-damage Chainsaw maxes it; the player's 3×-DPS wand loses. *This is the headline bug.*
- **`scoreAoe`** uses `maxExplosionRadius` (geometry) with no AoE damage (Principle 9).
- **MOBILITY/DEFENSIVE** are binary feature counts (no quality) — acceptable, lower priority.
- **Generation** hill-climbs this broken fitness (so it *seeks* the chainsaw), builds on the HELD
  chassis only, and depth-1 search can't discover trigger chains. Fixing fitness fixes much for free.

## 3. Fix plan

### Tier 0 — structural, tractable, verifiable (IMPLEMENTING NOW)

**T0.1 Payload-aware damage + explosions — `sim/metrics.ts`.**
- The damage/explosion walk recurses into `projectile.trigger` (a `WandShot` with its OWN
  `castState`). Per shot: each projectile contributes `max(0, stats.damage +
  castState.damage_projectile_add) × 25` + its explosion (intrinsic `explosionDamage` or
  `damage_explosion_add`); then recurse each `projectile.trigger`. Depth cap (16) for safety;
  `damageApproximate` propagates. `maxExplosionRadius` + a NEW `maxExplosionDamage` also recurse
  (a trigger→bomb's explosion lives in the payload).
- **Throughput counts (`projectilesPerCast/Cycle/Second`) stay TOP-LEVEL** — fire rate = independently
  fired shots; triggered payloads aren't independent fire-rate. (Documented choice.)
- **Semantics:** payload damage is added to the carrier's per-cast damage = "damage delivered per cast
  assuming the trigger connects" — consistent with the existing optimistic single-hit model.
- Non-trigger wands are unchanged (no `trigger` → recursion adds nothing) → existing goldens hold.

**T0.2 SPAM gets a damage term — `archetypes.ts`.**
`SPAM = sat(sustainedDps, REF_SPAM) × rateFactor × manaFactor`, where `sustainedDps` is now
payload-aware, `rateFactor = 0.7 + 0.3·sat(projectilesPerSecond, REF.projPerSec)` (keeps the
rapid-fire identity without letting a 0-damage emitter score), `manaFactor = 1` if mana-sustainable
else `0.35` (a spammer must sustain). `REF_SPAM` provisional (~120), documented; calibrated in Tier 2.
**Property:** a 0-damage deck → SPAM 0; higher sustained-effective-DPS at comparable rate → higher SPAM.

**T0.3 AoE weights explosion DAMAGE — `archetypes.ts` (+ the new metric).**
`AOE = 0.6·sat(maxExplosionDamage, REF_AOE_DMG) + 0.25·sat(maxExplosionRadius, 60) +
0.15·sat(projectilesPerCycle, 12)` — damage-dominant, radius secondary, spray tertiary. A digging-only
blast (radius>0, damage 0) no longer scores like a nuke.

### Tier 1 — multiplicative correctness (VERIFY engine fields first, then implement)

- **✅ Crit (DONE 2026-06-22).** Verified: `damage_critical_chance` IS set by 13 actions (crit spells /
  triggers); `damage_critical_multiplier` is never set (the ×5 is a game constant). Implemented in
  `metrics.ts` `critMultiplier = 1 + min(c,1)·(5·max(1,c) − 1)` (c = chance/100), applied per shot to
  direct projectile damage AFTER additive adds. `c=0 → ×1`, so goldens are byte-identical. Validated:
  `CRITICAL_HIT` → ×1.5, ×3 → ×2.5. **Remaining:** explosion-crit.
- **❌ Velocity damage — DEFERRED (decided 2026-06-22, grounded, do NOT implement a static model).**
  Verified against the engine + wiki: `speed_multiplier` (default **1.0**, engine-clamped **[0,20]**) is
  the projectile-LAUNCH-speed modifier, and it is an **anti-proxy** for the real damage bonus. Noita's
  speed damage = `(FinalSpeed/InitialSpeed) × BaseDamage` **computed on impact**
  (noita.wiki.gg/wiki/Spells_With_Damage_Scaled_By_Speed), so the strongest velocity builds *lower*
  initial speed (Heavy Shot ×0.3, Accelerating Shot ×0.32) to maximize the ratio — a naive
  `×speed_multiplier` model would score them as a damage **penalty** (sign-inverted). It also: applies
  to only **5 vanilla projectiles** (Arrow, Bouncing Burst, Disc, Energy Sphere, Infestation), and needs
  flight physics (air_friction/gravity/mass/distance-to-target) absent from `projectileStats.generated`.
  A static approximation would make scoring WORSE, not better. **Unblock = regen the projectile table
  with air_friction/mass/acceleration + assume an impact distance**, then an upper-bound "potential
  with a velocity build" figure shown SEPARATELY from baseline DPS — never folded in, never keyed off
  `speed_multiplier`. Until then: not modeled.
- **Range/lifetime usability factor** — down-weight DPS that can't reach a reference engagement
  distance, from `projectileStats` lifetime × speed. (Modeling choice; pick the reference distance.)
- **Effective-DPS mana model** — blend burst-rate for `secondsUntilStall` then the regen-limited rate,
  replacing the binary `manaSustainable` gate where it matters.

### Tier 2+ — completeness + generation (specced)

- **✅ Status/DoT (DONE 2026-06-22) — capability flag, not a damage number.** All three DoTs (fire,
  poison, toxic) tick ~2% max-HP/s (the boss/tank answer a raw-HP model can't see), but poison/toxic
  is a material-STAIN status, not a projectile damage field, so it can't be quantified from our data
  (no `poison` in any `damage_by_type`; ~0 actions set `damage_fire_add`). So `WandMetrics.appliesDot
  {fire,poison,toxic}` detects the CAPABILITY from data we have — projectile `damageByType.fire`,
  `castState.material`/`trail_material` (NUKE→fire; TRAIL_FIRE/POISON/TOXIC), and poison/acid-spraying
  entity paths — defaulting all-false (goldens-safe), recursing trigger payloads, surfaced as a DAMAGE
  reason for the boss/tank lens WITHOUT changing the score (no fabricated number). Honest gaps: no
  DoT-HP figure (needs material-emission extraction + a boss-HP ref), and a few pure-explosion fire
  emitters (fireblast) are missed (path-matching 'fire' would trip `friendly_fire`). Grounded:
  noita.wiki.gg Fire / Toxic Sludge / Damage_types.
- **✅ Generation chassis-selection (DONE 2026-06-22).** Generation now builds on **ALL** the player's
  owned wands (≤4), not just the held one — the trustworthy scorer + the existing per-archetype
  tier-list merge rank the best (wand, deck) per archetype, each build attributed to its source wand
  ("rebuild your slot-2 wand · cap 19", icon-ready). `GenerateRequest.chassis` is a `Wand[]`;
  `generateForArchetype` loops chassis into one candidate pool with a **fair per-chassis sub-budget**
  (`ceil(MAX_CANDIDATES/N)`, so chassis #1 can't starve the rest); **N=1 (theorycraft) is byte-identical**
  to the old path; owned caps stay per-build. (`generate.ts`, `useGeneration.ts` `ownedChassis`,
  `tierListViewModel` `chassisLabel`.) **✅ Modifier-stacking templates (DONE 2026-06-22):** a
  **`multiplicative-stack`** template (damage modifiers BEFORE a multicast → broadcast to every draw,
  the meta's multiplier engine) + a **`cheap-shot-spam`** ([modifier, cheap-shot] pairing) fallback,
  both shuffle-gated + cap-safe. Engine-validated (modifier-broadcast ≈ 6× the bare multicast: sustDps
  43→257) and end-to-end (a mixed pool now tops DAMAGE at 89/S where the bare multicast was 13/D).
  Grounded finding: crit BEFORE a trigger does NOT boost the payload, so the multiplier template uses
  multicast-broadcast, not pre-trigger mods. **Still Tier 2:** **deeper-than-depth-1 search** to
  *discover* chains beyond template seeds (polish still can't fill empty slots, so build quality is
  bounded by template shape + depth-1 — a follow-on).
- **REF-constant calibration** — once damage is payload-aware + the reload-overlap fix raised
  fast-wand DPS, the magnitudes shifted. **`REF.sustainedDps` re-grounded 150→300 (2026-06-22)** so S
  is elite DPS (was: the 300–2000+ range all collapsed to S); monotonic, band intent pinned in
  `archetypes.test.ts`. **Still provisional:** `MANA_PENALTY` + a full corpus calibration of all
  `REF`s against REAL captured wands (`captures/`) — blocked on richer captures than the current
  fresh-run starters (the committed fixtures are all ≤117 DPS).

## 4. Verification

- **Unit (TDD):** a trigger→heavy-payload wand now scores **>>** its carrier-alone variant, and a
  non-trigger wand is unchanged (T0.1); a chainsaw-spam deck scores **lower SPAM** than a real damage
  wand and a 0-damage deck → SPAM 0 (T0.2); a damaging blast > a digging-only blast for AoE (T0.3).
- **Real-data:** rebuild the chainsaw-vs-held-wand comparison from the live run and assert the
  inversion is gone (held wand ranks above the chainsaw on SPAM); sanity-check a real captured wand.
- Keep the full suite green; browser-verify live (zero console errors, sane tiers).
- Fresh-context review of the diff vs this spec before "done."
