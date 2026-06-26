# Scoring v2 — maintainer test notes

> Drop findings here while driving the app. I (Claude) read this file at the start of the next
> session and turn each item into a fix or a band-tuning change. The app currently shows the
> **bundled demo fixtures** (`◉ demo data` in the header) — to test your OWN run you need a live
> capture (the F8/F7 loop). **Band cutoffs are PROVISIONAL** (`src/analysis/ttk.ts`,
> `digging.ts`) — exactly the numbers your validation is meant to tune, so "this tier feels
> wrong" is the most useful kind of note.

## How to log an issue

Copy the block below per finding. The **why** is the important part — it's the meta reasoning
that drives the fix (not a tier label). Severity: `blocker` (crashes/broken) · `ranking` (wrong
order / wrong tier) · `metric` (a number reads wrong) · `copy` (label/wording) · `ui` (layout).

```
### [severity] short title
- Where: <Damage|AoE|Spam|Digging> tab · <held wand | a "✦ build idea">
- Deck: <spell ids, or describe it>
- Shows: tier <S/A/B/C/D>, score <n>, metric "<the line, e.g. Kill · boss 8.4s>"
- Expected: <what it should be>
- Why (meta): <the mechanic reason — e.g. "this one-shots, so boss TTK should be ~0.5s">
```

---

## Known scorer blind spots (Claude-noted; not bugs)

- **Big-pool "burst-then-dry" boss kill:** the DAMAGE **boss** anchor is now scored at the
  SUSTAINED (mana-honest) rate (the mana-sustainability fix, 2026-06-26), so a wand that empties a
  large pool over a few casts to delete the boss and *then* stalls is rated by what it can sustain
  — slightly UNDER-rated for that one-off boss delete. It is NOT a true one-shot (which the
  one-cast overkill floor still catches at full burst). Maintainer-approved direction ("you can't
  out-burst a boss you can't out-last"); flagged for transparency. The mid bruiser still keeps the
  burst phase, so short fights are unaffected.
- **Enabler vs sustainability tension:** a cast-speed enabler (Luminous Drill / Chainsaw) raises
  DAMAGE when there's mana headroom, but on a LOW-regen wand it trades sustainability for speed and
  the mana-honest boss anchor prefers the sustainable (Mana-Reduce) build — so the drill may not top
  the suggestions on a mana-starved chassis. Working as designed; surfaced here so it doesn't read
  as "enablers are still excluded".

## Findings

### [blocker] RECHARGE recharge-cut double-counts → inflated fire rate (sim fidelity, 2026-06-26)
- Where: any DAMAGE build pairing `RECHARGE` with a RE-DRAW — a trigger/timer payload (`SPITTER_TIMER`)
  or a deck-wrap forced by a trailing modifier (`LONG_DISTANCE_CAST`). Surfaced on a slot-3 "Multiplier
  build" (`MANA_REDUCE, CRITICAL_HIT, RECHARGE, SPITTER, LONG_DISTANCE_CAST, SPITTER_TIMER`) rated S/82
  that the maintainer confirms is horrible + **"isn't fast at all"**.
- Isolation (`computeMetrics` reloadTime, slot-3 chassis): `[RECHARGE, SPITTER]` → reload **15** (correct:
  base 35 − 20). `[RECHARGE, SPITTER, SPITTER_TIMER]` → reload **−5** (RECHARGE's `setCurrentReloadTime(−20)`
  applied TWICE). The re-draw re-casts RECHARGE into the SHARED reload accumulator. reload floors to 0 →
  cycle collapses to ~4 frames → model reads ~15×/sec / ~473 DPS; the real wand recharges (~3×/sec / ~105
  DPS). This is the fake-DPS source that makes a weak spitter-spam read S.
- BROAD: RECHARGE + trigger/timer is a very common combo. **GUARDRAIL:** the maintainer's GOOD slot-0 wand
  (`DAMAGE, CRITICAL_HIT, BURST_2, SPITTER, RECHARGE, SPITTER_TIMER×2, MANA_REDUCE×2`) shares RECHARGE +
  SPITTER_TIMER — any fix MUST keep it S (its strength is the 64-HP/cast multiplier, not the rate).
- STATUS: bug class **validated in isolation**; full-wand reproduction was INCONSISTENT with the live app
  (computed slot-0 346 DPS vs app's 5334), so the exact draw/reload interaction (order-dependent re-draws?
  engine module-state between `simulateWand` calls?) needs a careful READ-ONLY investigation of
  `src/engine/eval/clickWand.ts` (the `StartReload`/`reloadTime = args[0]` path + how trigger payloads /
  deck-wrap re-enter the draw loop) BEFORE any change. Fix must be in OUR layer (#4: engine untouched).
  Do NOT rush — verify it demotes the bad build AND keeps the good slot-0 wand S.

<!-- add entries below this line -->
