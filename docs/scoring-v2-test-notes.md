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

## Findings

<!-- add entries below this line -->
