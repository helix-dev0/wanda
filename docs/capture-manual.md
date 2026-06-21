# M0 fixture capture — manual test script (human-in-the-loop)

> **This is the STOP point for M0-T4.** The `mod/` Lua **cannot be self-tested** — it needs
> the running game, and I (Claude) am not the test loop, **you** are. Nothing about this mod is
> "confirmed working" until you run it and paste the results back. The mod is a **throwaway**
> one-shot capturer: it only *extracts* state (no logic, no UI) so we can record real JSON
> fixtures and then build the entire app against them with zero further game access.
>
> Every Noita API call in the mod is grounded in real source (EZWand, vanilla scripts, the
> official Lua API). A few things docs couldn't fully confirm are **flagged** below — your
> capture doubles as the probe that resolves them (see §6).

---

## 1. What you'll produce

- **5–10 `wand_capture_snapshot_N.json`** — one per held wand, covering varied shapes (see §4).
- **`wand_capture_spell_db.json`** — the spell DB dumped from your game.
- **`wand_capture_perk_db.json`** — the perk DB dumped from your game.
- **`logger.txt` lines containing `[wand_capture]`** — diagnostics (paste these too; they confirm
  the flagged unknowns).

Paste all of these back and I'll freeze them as fixtures (M0-T5) and validate them against the
schemas.

---

## 2. Install the mod

The mod folder **must be named exactly `wand_capture`** (the Lua `dofile` paths hard-code it).

Copy the **contents of this repo's `mod/` folder** (`init.lua`, `mod.xml`, `EZWand.lua`,
`json.lua`) into a new folder `wand_capture` inside your Noita install's `mods/` directory:

- **Linux / Proton (Steam):**
  `~/.steam/steam/steamapps/common/Noita/mods/wand_capture/`
  (also possible: `~/.local/share/Steam/steamapps/common/Noita/mods/wand_capture/`)
- **Windows (Steam):**
  `C:\Program Files (x86)\Steam\steamapps\common\Noita\mods\wand_capture\`

Quick way to find the install dir: Steam → right-click **Noita** → *Manage* → *Browse local files*,
then go into `mods/`.

After copying, the folder should contain:
```
mods/wand_capture/
  init.lua
  mod.xml
  EZWand.lua
  json.lua
```

## 3. Enable it (unsafe mods ON)

1. Launch Noita → **Main Menu → Mods**.
2. Click through the "modding may break things" / "I understand" warning.
3. **Enable "Allow unsafe mods"** (this mod writes files, so it needs `request_no_api_restrictions`).
4. **Enable `wand_capture`** in the mod list.
5. **Restart Noita** if it asks.
6. Start (or continue) a run. On spawn you should see on-screen:
   `[wand_capture] ready: F8 = capture snapshot, F7 = dump spell/perk DBs`
   — if you see that, the mod loaded.

---

## 4. Capture procedure

**Hotkeys:** **`F8`** = capture a snapshot of the **wand you're currently holding** + your spell
bag + perks. **`F7`** = dump the spell & perk databases (do this **once**).

1. **Press `F7` once** (anywhere in a run) to dump the two DBs. You should see
   `[wand_capture] DB dump: spells=… perks=…` on screen.
2. For each wand you want to capture:
   a. **Hold the wand** in your active hand.
   b. **Open your inventory once** (default `I`) and close it — this makes the game populate
      the spell **slot positions** so empty-slot `null`s land correctly. (Optional but recommended.)
   c. **Press `F8`.** You should see `[wand_capture] wrote wand_capture_snapshot_N.json (wands=1, …)`.
3. **Aim for 5–10 captures covering these shapes** (swap/buy wands as needed — Holy Mountain
   shops are handy):
   - a **shuffle** wand and a **non-shuffle** wand,
   - one with a **multicast** (Double/Triple Cast),
   - one with a **trigger** spell (e.g. Spark Bolt w/ Trigger),
   - a **mana-hog** (e.g. Black Hole / a heavy nuke),
   - one with an **always-cast** spell attached,
   - ideally one **near-empty** and one **full** wand.
4. Pick up a couple of **perks** during the run (a stackable one like **Extra Health** twice, if
   you can) so the perk capture and stack count have something to show.

Each `F8` writes a new numbered file (`_1`, `_2`, …). It's fine if a wand isn't held when you
press F8 (it just records an empty `wands` list) — but for fixtures, hold a wand.

---

## 5. Find the output files and collect logs

The mod writes with a **relative path**, so the files land in Noita's **working directory**.
That's *most likely* the **install dir** (next to `Noita.exe`), but it could be the save dir — so
search both for `wand_capture_*.json`:

- **Save dir (also where `logger.txt` lives):**
  - Linux/Proton: `~/.steam/steam/steamapps/compatdata/881100/pfx/drive_c/users/steamuser/AppData/LocalLow/Nolla_Games_Noita/`
  - Windows: `%USERPROFILE%\AppData\LocalLow\Nolla_Games_Noita\`
- **Install dir:** the `Noita/` folder from §2 (the one containing `Noita.exe`).

Linux one-liner to find them all:
```bash
find ~/.steam ~/.local/share/Steam -name 'wand_capture_*.json' 2>/dev/null
```

**Tell me the full path where you found them** — that resolves where `io.open` writes (needed for
the live bridge in M1).

Then open `logger.txt` (in the save dir above) and copy **every line containing `[wand_capture]`**.

---

## 6. What to paste back (and the flagged unknowns these confirm)

Paste back:
1. **All `wand_capture_snapshot_N.json`** files (5–10).
2. **`wand_capture_spell_db.json`** and **`wand_capture_perk_db.json`**.
3. **All `logger.txt` lines containing `[wand_capture]`**.
4. **The full filesystem path** where the JSON files were written.

The diagnostics in (3) answer these open questions (don't worry about them yourself — just paste
the lines; I'll read them):

| # | Flagged unknown | What the logs/files tell us |
|---|---|---|
| 1 | **Spell-bag entity name** (`inventory_full` unconfirmed) | The `player child: '…'` lines list every child of the player — we confirm which one holds your loose spells. If `spell_inventory` is empty but you had loose spells, this is why. |
| 2 | **`io.open` write location** (CWD uncertain, cross-platform) | The path where you found the files (and whether any `WRITE FAILED` line appears). |
| 3 | **Perk stack counts** (`_PICKUP_COUNT` global may not exist) | If you picked a stackable perk twice, does its `stacks` read `2` or `1` in the snapshot? |
| 4 | **Loose-spell `uses_remaining`** | Do loose spells show a number or `null` for `uses_remaining`? |
| 5 | **Spell slot ordering** (`inventory_x` reliable only after opening inventory) | Whether empty-slot `null`s line up with what you saw in-game (did you open the inventory before F8?). |

---

## 7. If something goes wrong

- **No `[wand_capture] ready` message on spawn** → the mod didn't load. Re-check the folder is
  named exactly `wand_capture`, contains all 4 files, is enabled, and **unsafe mods is allowed**.
- **`[wand_capture] WRITE FAILED …` in the log** → the working dir is read-only (common if Noita
  is in `Program Files`). Note it and tell me — we'll switch M1 to an absolute save-dir path.
- **`spell_inventory` empty though you had loose spells** → expected if the bag child isn't named
  `inventory_full`; the `player child:` log lines tell us the real name (flag #1).
- **A snapshot has `wands: []`** → you weren't holding a wand when you pressed F8.
- **Lua error in the log** → copy the full error line; that's exactly what I need to fix it.

> Reminder: I have **not** verified any of this in-game — that's what this loop is for. Paste the
> results and I'll reconcile the schemas against your real data in M0-T5.
