# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A live assistant for the game **Noita** that mirrors the player's current run, simulates
what their wands actually do, analyzes them, and generates strong builds. Full design lives
in [`noita-wand-assistant-spec.md`](./noita-wand-assistant-spec.md) — read it before any
planning. Milestones run M0 (fixtures/schema) → M6 (in-game overlay).

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

## Commands

> **Not yet scaffolded.** The app does not exist until M2. When the Vite app is scaffolded,
> record the real build / lint / test / single-test / dev-server commands here. Locked core:
> TypeScript + React + Vite (invariant #1). **Pin every dependency to the latest stable,
> best-in-class option, version-checked via Context7 at scaffold time** — test runner (Vitest the
> likely default), state management, file-watch lib, and the cross-platform desktop shell
> (Tauri vs Electron — decided in the plan, favouring the lighter cross-platform option given
> invariant #8). **Do not fabricate commands or version numbers before the scaffold exists.**

## Workflow notes
- Spec → plan → implementation are distinct phases; the `.md` artifact is the handoff.
- Before non-trivial work is "done," run a fresh-context subagent to review the diff against
  the spec/plan. The writer doesn't grade its own work.
