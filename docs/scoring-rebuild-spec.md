# Scoring Rebuild Spec — transparent, meta-grounded fitness + exhaustive search

**Status:** APPROVED direction (maintainer chose "rebuild fitness + exhaustive search", 2026-06-22).
**Why:** the scorer was a heuristic patched gap-by-gap, so it kept mis-ranking wands the maintainer
(ground truth) knows are wrong — most starkly, it rated a **close-range digging wand** (`BURST_2 +
Luminous Drill ×3`) as **DAMAGE 60/A** while its real damage suggestions sat at 9/D. This rebuilds the
fitness around **one transparent, simulator-derived number** and adds a **simulator-driven exhaustive
search** so generation can no longer miss optima.

Grounded by: the 8-dimension meta audit (workflow `noita-scoring-meta-audit`, 2026-06-22) + two manual
grounding agents (Luminous-Drill/Chainsaw classification; mana model + multicast draws) + the live
reach-calibration probe. Sources: noita.wiki.gg + the vendored salinecitrine engine (cited inline).

## 0. Maintainer ground truth (overrides wiki edge-cases)
- **`BURST_2 + Luminous Drill ×3` is a DIGGING wand, NOT a damage weapon — because it is close range.**
  So a high DAMAGE score for it is a SCORING BUG, not a build the generator failed to find. The generator
  was CORRECT to keep drills out of damage decks; the bug is the held-wand scorer being range-blind.
- Luminous Drill *can* be a damage tool as an advanced Spells-to-Power timer payload (wiki), but the tool
  can't distinguish that from raw drill-spam, and the maintainer plays it as digging → an enabler-ONLY deck
  (drill×3) is digging, scored low by range.
- **🔑 ENABLERS belong IN damage wands (maintainer, 2026-06-22).** Chainsaw (`fire_rate_wait = 0`, the "time
  manipulation") and Luminous Drill (−35 cast delay) are used in damage wands **to increase casts/second**.
  Paired with a real ranged payload they roughly HALVE the cycle → ~2.5× DPS (validated: `BURST_3 + Chainsaw
  + 2 Bouncy` cycle 48→20, DAMAGE 11/D→21/C; with Drill 47/B). The sim already models this; the honest scorer
  (damage-weighted reach keeps it "ranged" because the payload carries the damage) already REWARDS it. So:
  **the generator must NOT exclude enablers from damage builds** — the old `isUtilitySpell` blanket exclusion
  was a band-aid for the broken scorer and blocks the meta's core rapid-fire pattern. The exhaustive search
  enumerates the full pool (enablers included) and lets the honest scorer rank: enabler+payload → high,
  enabler-only → low (range). No exclusion needed once the scorer is trustworthy.

## 1. The single transparent number (what every archetype reads)

Per-shot expected HP — every damage channel counted **once**, crit (a shot-level accumulator) scales all:
```
critMul     = critMultiplier(castState.damage_critical_chance)            // ×1 at 0%; metrics.ts:87-90
typedDmg(st)= Σ damageByType[t]  for t ∉ {healing}                        // B1 — untyped + typed, one sum
directHP    = max(0, st.damage + typedDmg(st) + damage_projectile_add) * 25
explosionHP = (st.explosionDamage>0 || damage_explosion_add>0)
              ? max(0, st.explosionDamage + damage_explosion_add) * 25 : 0
shotHP      = (directHP + explosionHP) * critMul                          // B2 — crit now scales BOTH
            + Σ shotDamage(p.trigger)                                     // payload recursion, own castState
```
Cycle → DPS → **the headline**:
```
sustainedDps          = damagePerCycle / cycleSeconds                     // unchanged (metrics.ts:161)
manaRatio             = manaPerCycle>0 ? min(1, regenPerCycle/manaPerCycle) : 1   // B4 — continuous, NOT a cliff
effectiveSustainedDps = sustainedDps * manaRatio                         // ← THE transparent headline
```
`manaRatio=1` exactly when mana-sustainable ⇒ `effectiveSustainedDps == sustainedDps` (goldens byte-identical).
Grounded: mana shortfall DROPS casts, not delays them (engine `gun.ts:333-337`), so long-run output scales
by `regen/drain`.

## 2. Usability factors (multiply the headline; each applied once, only where geometry matters)
- **Range / reach** (B3, the keystone for the maintainer's bug). `reach = speedMax*lifetime/60` (lifetime<0 ⇒
  endless ⇒ full credit), damage-weighted across the deck. `reachFrac = clamp(reach/REACH_REF, FLOOR, 1)`.
  Measured reach (real table): rubber_ball 9375, bouncy 6250, light_bullet 567, bubbleshot 500 (all ranged) vs
  **luminous_drill 47, chainsaw 7, laser 75** (close). `REACH_REF≈250`, `FLOOR≈0.1` ⇒ every current ranged
  fixture stays at 1.0 (goldens-safe) and close-range tools drop hard. Applies to **DAMAGE + SPAM only** (not AOE).
- **Spread → on-target** (already shipped): `onTarget = REF.spreadDeg/(REF.spreadDeg+max(0,spread))`. DAMAGE only.

## 3. Per-archetype blend (signature-dominant; factors multiply, damage is the additive base)
```
DAMAGE = 0.7*sat(effectiveSustainedDps*onTarget*reachFrac, REF.sustainedDps)
       + 0.3*sat(burstDps*onTarget*reachFrac, REF.burstDps)        // burst NOT mana-throttled (it IS the nova)
       // MANA_PENALTY deleted — mana already inside effectiveSustainedDps. DoT stays a NOTE, never a number.
SPAM   = sat(effectiveSustainedDps*reachFrac, REF.sustainedDps) * (0.6 + 0.4*sat(pps, REF.projPerSec)/100)
       // hard mana gate deleted — manaRatio is the smooth equivalent.
AOE    = 0.6*sat(maxExplosionDamage, REF.aoeDamage) + 0.25*sat(maxExplosionRadius,60) + 0.15*sat(ppc,12)
       // maxExplosionDamage now crit-scaled (B2b). No spread/range (a blast clears a crowd regardless).
```
**Anti-double-count contract:** untyped+typed+explosion are separate XML fields = separate HP applications
(sum once each); crit multiplies once in `shotHP`; mana multiplies once via `manaRatio`; spread/range are
hit-probability factors applied only where geometry matters. AOE reading `maxExplosionDamage` while DAMAGE
reads `effectiveSustainedDps` answers a different question (crowd lethality vs single-target DPS) — intended.

## 4. Prioritized gaps (all goldens-safe; full table in the audit synthesis)
| id | sev | gap | file:line | fix |
|---|---|---|---|---|
| B3 | major | DAMAGE/SPAM range-BLIND → close-range digger rates as elite damage | archetypes.ts scoreDamage/scoreSpam; metrics reachPx | add reachFrac factor (**the maintainer's keystone**) |
| B1 | **critical** | `shotDamage` ignores `damageByType` → CHAINSAW/ARROW/BALL_LIGHTNING + ~68 typed projectiles read 0 HP | metrics.ts:108 | sum typed (skip `healing`) |
| B4 | major | binary `MANA_PENALTY` cliff inverts meta (mild over-drain ≈ 10× over-drain) | archetypes.ts:61,107-110,137-139 | continuous `manaRatio` → `effectiveSustainedDps` |
| B2a/b | major | crit not applied to explosion (`:110`) or AoE blast (`:209`) | metrics.ts:110,209 | `* critMul` on both |
| D1-3 | minor | stale comments (crit "excluded"; "0-damage CHAINSAW"; carrier vs payload naming) | metrics.ts:6-7; archetypes.ts:127; templates.ts:89 | reword |
| B1b | major | per-type `castState` `_add` (electricity/slice/…) never read — DEFERRED | metrics.ts:99 | **BLOCKED** on game rule (open Q1) |

## 5. Implementation order (atomic slices, TDD, each validated vs the live anchor, fresh-context-reviewed)
Lead with the maintainer's keystone so the drill-wand proof-point lands first; every commit stays correct.
1. **B3 range factor** — drill/chainsaw drop out of the DAMAGE tier; ranged fixtures unchanged. *Proof point.*
2. **B1 typed damage** — chainsaw/arrow/ball-lightning read real HP, now safely under the range factor.
3. **B4 mana-continuous** — `effectiveSustainedDps`; drop `MANA_PENALTY`; honest sustained magnitudes.
4. **B2 crit-everywhere** — explosion + AoE blast crit-scaled.
5. **D1-3 comment cleanup** — no behavior change.
6. **Exhaustive search** — simulator-driven: enumerate spell *combinations* (cap-limited) exhaustively for
   small pools, a few meta-canonical orderings each, rank by the now-honest fitness. Feasibility (measured):
   fresh-run pool 190–1.2k sims (<1s, **provably best**); mid-game ~160k (bounded beam); late-game billions
   (templates + trimmed exhaustive core). Hybrid switch on candidate count. Keep determinism + off-thread.

## 6. Open questions for the maintainer (none block slices 1-6)
1. **B1b** per-type `_add` rule: does `damage_slice_add` augment only slice-bearing projectiles or all? (source-ground in gun_actions.ts before implementing; deferred till then).
2. `REACH_REF`/FLOOR exact values — pick conservative (ranged fixtures = full credit), calibrate vs real wands.
3. Radioactive 5%-HP floor — model or accept as approximation (2 projectiles)?
4. `secondsUntilStall` basis: current pool vs `manaMax` (display only).
5. Self-heal (`healing<0`) — track as a separate defensive signal later, or drop?
6. Material-crit spells (HITFX_*) — stays out of scope (needs live-game data). Confirm.
