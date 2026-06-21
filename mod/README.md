# wand_capture — M0 throwaway capture mod

Extraction-only Noita mod that writes schema-shaped JSON fixtures for the wand assistant.
See [`../docs/capture-manual.md`](../docs/capture-manual.md) for install + capture instructions.
**Untestable without the running game — human-in-the-loop (M0-T4). Not yet confirmed working.**

Hotkeys in-game: **F8** = capture snapshot · **F7** = dump spell + perk DBs.

## Files
- `init.lua` — capture/extraction logic (ours). No analysis, no UI (thin-mod invariant).
- `json.lua` — minimal JSON encoder with a null sentinel for empty spell slots (ours).
- `mod.xml` — mod manifest (ours); requests `request_no_api_restrictions` for `io` file writes.
- `EZWand.lua` — **vendored verbatim** from [TheHorscht/EZWand](https://github.com/TheHorscht/EZWand)
  **v2.2.3**, used for held-wand reads (`GetHeldWand` / `GetProperties` / `GetSpells`).

## Licensing caveat
`EZWand.lua` is **GPL-3.0**. This mod is for **personal, non-distributed** use only, which is
fine as-is. **If this mod is ever distributed**, GPL-3.0 obligations apply to the combined work —
revisit then (mirrors the engine-licensing caveat in `docs/plan.md`).
