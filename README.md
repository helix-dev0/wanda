# Wand Grimoire

A live desktop assistant for [Noita](https://noitagame.com/) that mirrors your current run,
simulates what your wands actually do, analyzes them, and generates strong builds. It runs
natively on **Linux and Windows**, reading your run live from a thin in-game capture mod — or
against bundled demo data with no game at all.

> **Status:** feature-complete through build generation (mirror → simulate → analyze → generate).
> Live in-game capture is experimental.

---

## Install

Download the latest from the repository's **Releases** page:

| OS | Download | Notes |
|----|----------|-------|
| **Windows** | `Wand Grimoire_<ver>_x64-setup.exe` (NSIS) or `_x64_en-US.msi` | Unsigned build → at the SmartScreen prompt click **More info → Run anyway**. The Edge **WebView2** runtime is fetched automatically if missing. |
| **Linux — Debian/Ubuntu** | `Wand Grimoire_<ver>_amd64.deb` | `sudo apt install ./Wand*.deb` |
| **Linux — Arch / other** | `Wand Grimoire_<ver>_amd64.AppImage` | `chmod +x Wand*.AppImage && ./Wand*.AppImage` (self-contained) |

On first launch with no game running, the app shows a short "waiting for Noita" prompt. To preview
it with **no game and no setup**, run the browser dev build (see *Develop*) — that loads bundled
demo data.

---

## Live in-game use

1. **Install the capture mod.** Download `wand-capture-mod.zip` from the same Release and extract
   it into your Noita install's `mods/` folder so the path is `…/Noita/mods/wand_capture/`
   (the folder **must** be named `wand_capture`).
2. In Noita: **Mods → enable "Allow unsafe mods"** → enable **wand_capture** → restart when asked.
3. Start a run. The mod writes `snapshot.json` on change (~2×/sec); **F8** forces a capture and
   **F7** dumps the spell + perk databases.
4. **Point the app at that `snapshot.json`.** It auto-detects the common Steam locations:
   - Linux (native): `~/.local/share/Steam/steamapps/common/Noita/snapshot.json`
   - Windows: `C:\Program Files (x86)\Steam\steamapps\common\Noita\snapshot.json`
   - **Linux via Proton:** the file lands inside the game's Proton prefix, which can't be
     auto-derived — set the path in the app's settings (it's under your Steam library's
     `steamapps/compatdata/<appid>/pfx/drive_c/…`).

---

## Develop

Requires **Node ≥ 20** (developed on 26); the native build also needs the **Rust** toolchain.

| Task | Command |
|------|---------|
| Browser dev (demo data) | `npm run dev` |
| Browser dev against a live game | `npm run bridge` in one shell, then `VITE_LIVE=1 npm run dev` |
| Native app — dev window | `npm run tauri dev` |
| Native installers — this OS | `npm run tauri build` |
| Test · typecheck · lint | `npm test` · `npm run typecheck` · `npm run lint` |
| Build the capture-mod zip | `npm run package:mod` |

The app is **fixtures-first**: it runs fully against recorded snapshots in `src/data/fixtures/`
with no game. Live data flows mod → transport → the same validation boundary as fixtures, where
the transport is the **Tauri file-watch** (`src/bridge/tauriClient.ts`) inside the packaged app,
or the **Node WebSocket sidecar** (`bridge/watch.mjs`) in browser dev.

---

## Release

The version in `src-tauri/tauri.conf.json` is the source of truth. To cut a release:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The `release` GitHub Actions workflow builds installers for Linux + Windows via
`tauri-apps/tauri-action` and **drafts** a Release with them plus `wand-capture-mod.zip`
attached. Review and publish the draft.

> Windows installers are only **build**-verified by CI. Confirm one actually runs on a Windows
> machine before sharing the release.

---

## Architecture & licensing

Two parts, strict split of responsibility: a **thin Lua mod** (`mod/`) that does state extraction
only, and this **TypeScript / React / Vite** app that holds all logic + UI. The cast simulator in
`src/engine/` is vendored from
[salinecitrine/noita-wand-simulator](https://github.com/salinecitrine/noita-wand-simulator), and
the mod vendors GPL-3.0 [EZWand](https://github.com/TheHorscht/EZWand).

**This repository is private.** The vendored engine ships without a license (all rights reserved) —
do not redistribute it publicly without a grant from its author (see `src/engine/README.md`). The
distributed mod is GPL-3.0 (see `mod/README.md`). Full design lives in
[`noita-wand-assistant-spec.md`](./noita-wand-assistant-spec.md).
