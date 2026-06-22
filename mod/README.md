# wand_capture — Noita extraction mod

Extraction-only Noita mod for the **Wand Grimoire** companion app. It writes a schema-shaped
`snapshot.json` of your held wands + spell bag + acquired perks (on change, ~2×/sec) which the app
reads live. **Extraction only — no analysis, no UI** (the app holds all the logic). Live capture is
experimental.

Hotkeys in-game: **F8** = force-capture a snapshot now · **F7** = dump the spell + perk databases.

## Install
1. Download `wand-capture-mod.zip` from the Wand Grimoire GitHub Release and extract it into your
   Noita install's `mods/` folder, so the path is `…/Noita/mods/wand_capture/`. The folder **must**
   be named `wand_capture`.
2. In Noita: **Mods → enable "Allow unsafe mods"** (this mod needs file I/O —
   `mod.xml: request_no_api_restrictions`) → enable **wand_capture** → restart when prompted.
3. Start a run. The mod auto-writes `snapshot.json` on change; **F8** forces a capture and **F7**
   dumps the spell/perk DBs. Point Wand Grimoire at that `snapshot.json` — the app auto-detects the
   common Steam/Noita locations, and you can override the path in the app's settings (Proton users
   on Linux will need to set it). See the app's README for the snapshot-path details.

## Files
- `init.lua` — capture/extraction logic. No analysis, no UI (thin-mod invariant).
- `json.lua` — minimal JSON encoder with a null sentinel for empty spell slots.
- `mod.xml` — manifest; requests `request_no_api_restrictions` for `io` file writes.
- `EZWand.lua` — **vendored** from TheHorscht/EZWand v2.2.3 (held-wand reads).
- `LICENSE.GPL-3.0.txt` — GPL-3.0 license text (see Licensing).

## Licensing
`EZWand.lua` is **© TheHorscht, licensed GPL-3.0** (v2.2.3,
<https://github.com/TheHorscht/EZWand>). Because this mod bundles and distributes it, the mod is
distributed under **GPL-3.0**: the full license text is in `LICENSE.GPL-3.0.txt`, and the
corresponding source is the `.lua` files included in this archive. The remaining mod files
(`init.lua`, `json.lua`, `mod.xml`) are authored for this project.
