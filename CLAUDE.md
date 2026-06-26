# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A live assistant for the game **Noita** that mirrors the player's current run, simulates
what their wands actually do, analyzes them, and generates strong builds. Full design lives
in [`noita-wand-assistant-spec.md`](./noita-wand-assistant-spec.md) — read it before any
planning. Milestones run M0 (fixtures/schema) → M6 (in-game overlay).
**Current status + what's next: [`docs/progress.md`](./docs/progress.md)** (M0 + M2–M5 shipped; M1 mod
in progress, M6 overlay pending). **The scoring engine was REBUILT** to the TTK-grounded
[`docs/scoring-model-v2-spec.md`](./docs/scoring-model-v2-spec.md) (shipped + live-hardened 2026-06-26;
replaced the untrusted heuristic scorer in place) — DAMAGE/AOE/SPAM = expected TTK vs cited reference
enemies, DIGGING first-class, MOBILITY→flag, DEFENSIVE dropped. Band cutoffs stay provisional and a few
blind spots remain (homing unmodeled, always-cast approximate) — see progress.md + `docs/scoring-v2-test-notes.md`.

## NON-NEGOTIABLE invariants (already decided — do NOT re-litigate or "improve")

1. **Two components, strict split of responsibility:**
   - A deliberately **THIN Noita Lua mod** that does **state extraction ONLY** — no logic, no UI.
   - A **TypeScript / React / Vite companion app** that holds **ALL logic + ALL UI**.
2. **The mod is the only code that requires the running game to test.** Keep it minimal;
   change it rarely. Every line added to the mod is a line that cannot be auto-tested.
3. **The app is developed and verified ENTIRELY against recorded JSON fixtures, never a live
   game.** Capturing fixtures is the *only* time the game is needed for app work.
4. **Do NOT build a wand simulator from scratch.** Reuse/fork an existing open-source engine
   (`salinecitrine/noita-wand-simulator`, or the MIT `awlego/noita-wand-visualizer`) as the
   source of truth for cast mechanics.
5. **The spell database is generated from the player's OWN game files at runtime by the mod**
   — not hand-maintained — so it stays correct across game versions and spell-adding mods.
   A vanilla snapshot is bundled only as a fallback.
6. **Read-only relationship with the game.** No cheat features (no auto-aim, no spawning items).
7. **Locked architecture choices:** Lua-mod data path (mod flagging acceptable); app first,
   in-game overlay deferred to M6; full ambition (mirror → simulate → analyze → generate);
   **file-watch bridge is the default**, websocket optional later.
8. **Cross-platform is a hard requirement.** The maintainer runs Noita on **Linux via Proton**;
   a co-player runs **Windows + Steam**. The tool must work on both (a separately-packaged
   `.exe`/native build per OS is acceptable). Each player runs their own local instance — this
   is NOT networked/multiplayer. Two consequences that are now binding:
   - The **file-watch bridge** is not merely the default, it is the only inherently
     cross-platform option (pure Lua `io`). The optional websocket bridge depends on the
     Windows-only `pollws.dll`; if ever built it must stay strictly optional and Windows-gated.
   - Game/mod **paths differ by platform** (Proton compatdata prefix vs native Windows Steam).
     Snapshot-output and game-install paths must be configurable/auto-detected per OS, never
     hardcoded to one platform.
9. **The app determines wand quality AUTONOMOUSLY (maintainer, 2026-06-23) — never from human labels.**
   "Good" is derived from (a) the **simulator engine** (what a wand objectively does — DPS, mana, range,
   draws, payloads) + (b) **encoded Noita wand-building meta** that the developer grounds in the game files +
   noita.wiki.gg and cites. It must NEVER require the maintainer (or the agent) to hand-rate wands: **no
   curated golden-tier corpus, no "tell it the tier" calibration, no fitting scores to human ratings.** The
   maintainer is a validator/sanity-checker, not a labeler. Scoring constants (REF thresholds, REACH_REF, …)
   are grounded in **cited meta facts** (enemy-HP curves, rapid-fire / high-damage guide thresholds, the
   multiplicative-stacking math), and the engine is validated by checking its OUTPUT against meta KNOWLEDGE
   (a meta-expert reasoning from the wiki) — not by fitting to labels. The simulator stays vendored TS
   (invariant #4), so the scorer lives next to it; "use a different backend/API" doesn't change this —
   correctness comes from the model + meta grounding, not the language. **Canonical realization — SHIPPED
   2026-06-26: [`docs/scoring-model-v2-spec.md`](./docs/scoring-model-v2-spec.md) — expected TTK vs wiki-cited
   reference enemies replaced the abstract REF blend; validated by the corpus harness + meta-expert sign-off +
   a fresh-context review, then live-hardened. (Supersedes `docs/scoring-rebuild-spec.md` v1; the old
   REF/REACH_REF constants are gone — the grounded constants are now the reference-enemy HP + provisional TTK
   band cutoffs.)**

## Testing discipline (this is the heart of the project)

- **App = 100% automated.** Everything runs against recorded fixtures + unit tests (TDD:
  red → green → refactor). UI work is verified in a real browser via the
  browser-testing-with-devtools skill before it is called done. **"Seems right" is never
  sufficient** — show passing tests / real runtime output.
- **Mod = human-in-the-loop.** Any task that touches the Lua mod, or otherwise needs the
  running game, **cannot be self-tested.** Implement it, then **STOP** and hand the user a
  copy-paste manual test script plus exactly which `logger.txt` lines / emitted JSON to paste
  back. **NEVER claim the mod works without the user's confirmation.**
- **Keep the app runnable against fixtures at all times.** Gate any not-yet-wired live-data
  path behind a safe default / flag.
- Commit in **small atomic slices** with clear messages — one vertical slice at a time.

## Architecture

Two components plus a bridge (see spec §3). Guiding principle: **keep the untestable Lua piece
tiny and dumb; put all logic in the app where automation is total.**

- **Component A — Noita extraction mod (Lua).** Reads game state via the ECS / EZWand and emits
  a JSON snapshot **on change only** (held wands, spell inventory, acquired perks; world-visible
  shop/pedestal/perk-offering contents arrive in a later additive slice). Also dumps the spell DB
  (`gun_actions.lua`) and perk DB (`perk_list.lua`) once from the running game. No analysis, no UI.
  **Must read the spell inventory compatibly with the Advanced Spell Inventory mod** (Workshop
  `3267869519`, a QoL inventory mod the maintainer runs) — source-verify its storage at M1.
- **Bridge.** Default = mod writes `snapshot.json` to a known path; app file-watches it
  (~250ms latency, no native code). Optional later = localhost websocket via FFI + `pollws.dll`.
- **Component B — Companion app (TypeScript/React/Vite).** Modules: ingestion+schema-validate →
  run-state store (current wands + spell inventory + a persistent "seen this run" ledger,
  reset on run change) → spell DB → **reused** simulator engine → analysis engine → generation
  engine → UI.

### Data contracts (see spec §4)
- **Snapshot** (mod → app): `run_id` (change ⇒ reset run ledger), `wands[]` (stats +
  ordered `spells[]` with `null` for empty + `always_cast[]`), `spell_inventory[]`, optional
  `world_seen`.
- **Spell DB entry** (dumped from game): `id`, `name`, `type`, `mana`, `max_uses`,
  `deck_modifier`, `projectile`, etc.

## Reusable prior art (don't reinvent — see spec §8)
`salinecitrine/noita-wand-simulator` and MIT `awlego/noita-wand-visualizer` (engine
candidates) · `TheHorscht/EZWand` (Lua wand read/write) · Streamer Wands &
`probable-basilisk/noita-ws-api` (live export bridges).

## Source-grounding rule
Ground every Noita-modding and framework decision in official docs or the reused engine's
**actual code** — never write API/library calls from memory. **Context7 is the default doc
source for every library/framework/SDK throughout this project** — resolve the library and
query its docs before writing or changing framework code; supplement with the installed
package's own types. Explicitly flag anything that cannot be verified. For Noita/Lua specifics
the equivalent of Context7 is the **actual Lua source** — the game's own scripts and the reused
mod/engine repos. Read them, don't recall them.

## Stack & commands

**Decided (2026-06-21, plan approved; versions Context7-verified — see `docs/plan.md`):**
TypeScript 6 · React 19 · Vite 8 (`react-ts`) · Vitest 4 · **Valibot** (schema validation) ·
chokidar 5 (live-bridge file-watch; Node ≥20, ESM-only) · **Tauri v2** (M6 packaging + overlay) ·
Zustand 5 (run-state). **Single Vite app, not a monorepo:** `src/{schema,engine,analysis,
generation,store,ui,data}` plus `mod/`, `bridge/`, `src-tauri/`. Live data flows through a small
Node chokidar→WebSocket sidecar behind `VITE_LIVE=1`; **fixtures are the default and the app must
always run without the bridge.**

**Scaffolded at M0-T1 (2026-06-21).** Single Vite `react-ts` app at repo root. Requires Node ≥20
(developed on Node 26). Installed at latest patches: Vite 8.0.16 · React 19.2.7 · TypeScript 6.0.3
· Vitest 4.1.9 · Valibot 1.4.1. Commands:

| Task | Command |
|---|---|
| Install | `npm install` |
| Dev server | `npm run dev` |
| Build (typecheck + bundle) | `npm run build` (`tsc -b && vite build`) |
| Typecheck only | `npm run typecheck` (`tsc -b`) |
| Test (once / CI) | `npm test` (`vitest run`) |
| Test (watch) | `npm run test:watch` |
| Single test by file/name | `npm test -- snapshot` (filename substring) · `npm test -- -t "rejects"` (test name) |
| Lint | `npm run lint` (`eslint .`) |
| Native app (dev window) | `npm run tauri dev` |
| Native installers (this OS) | `npm run tauri build` (Linux `.deb`/`.AppImage`; Windows `.exe`/`.msi`) |
| Package the capture mod | `npm run package:mod` (→ `wand-capture-mod.zip`) |

Test config: `vitest.config.ts` (Node env, `src/**/*.test.ts`, globals off — import from `vitest`).
Also installed since: **Zustand 5** (M2 run-state), **@floating-ui/react 0.27** (M5+ hover tooltips),
**chokidar 5 + ws** (M1 live bridge), **Tauri v2** (`@tauri-apps/{api,cli,plugin-fs}` — M6 packaging
brought forward), **adm-zip** (mod-zip tooling). See **Release pipeline** below.

## Release pipeline (M6 packaging — shipped)

The app ships as **native desktop installers** via **Tauri v2** (`src-tauri/`), wired to the
existing Vite app (`frontendDist: ../dist`, `beforeBuildCommand: npm run build`). The repo is
**private** — `git@github.com:helix-dev0/wanda.git` — because the vendored `src/engine` simulator
is all-rights-reserved; do **not** make it public without relicensing (see `src/engine/README.md`).

- **Cut a release:** bump `version` in `src-tauri/tauri.conf.json` (the source of truth), then
  `git tag vX.Y.Z && git push origin vX.Y.Z`. The tag triggers `.github/workflows/release.yml`
  (`tauri-apps/tauri-action`; matrix `ubuntu-22.04` → `.deb`/`.AppImage`, `windows-latest` →
  `.exe`/`.msi`), which **drafts** a GitHub Release with the installers + attaches
  `wand-capture-mod.zip`. Review, then publish the draft (`gh release edit vX.Y.Z --draft=false`).
- **Live data in the packaged app** uses Tauri `plugin-fs` `watch` (`src/bridge/tauriClient.ts`) —
  no Node sidecar, no `ws://localhost`, no firewall prompt. Browser dev keeps the Node WS bridge
  (`bridge/watch.mjs`); `startLive()` (`src/bridge/startLive.ts`) switches on `isTauri()`, and both
  feed the same `handleBridgeMessage` ingestion boundary. Snapshot path = per-OS default +
  localStorage override (Settings UI; required for Linux/Proton).
- **Windows is only BUILD-verifiable in CI.** The Linux maintainer cannot certify the Windows
  runtime — a Windows co-player must confirm the `.exe` actually runs before a release is trusted
  (same human-in-the-loop rule as the mod).
- First release: **v0.1.0** (2026-06-22) — both-OS installers + mod, published.

## Workflow notes
- Spec → plan → implementation are distinct phases; the `.md` artifact is the handoff.
- Before non-trivial work is "done," run a fresh-context subagent to review the diff against
  the spec/plan. The writer doesn't grade its own work.
