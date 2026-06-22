// Run recorder — persists every DISTINCT live snapshot to captures/ so a run's
// data survives death / restart (the mod overwrites snapshot.json in place, so a
// dead run is otherwise lost forever). THIN by design, like the bridge: it watches
// the same file, dedups by content, and writes the RAW text to disk keyed by the
// game frame + a wall-clock stamp. No validation, no transforms — faithful capture.
//
// Run it alongside (or instead of) the bridge:
//   npm run record                          # default Noita snapshot path + ./captures
//   WAND_SNAPSHOT=/path/to/snapshot.json WAND_CAPTURES=/path/to/out npm run record
//
// Promote an interesting capture to a real fixture by copying it into
// src/data/fixtures/snapshot_NN.json (relabel the placeholder run_id — see M1-T3).

import chokidar from 'chokidar'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultSnapshotPath } from './watch.mjs'

const snapshotPath = defaultSnapshotPath()
const outDir =
  process.env.WAND_CAPTURES ??
  join(dirname(fileURLToPath(import.meta.url)), '..', 'captures')

await mkdir(outDir, { recursive: true })

let last = null
let count = 0

/** Read the snapshot; if its text changed since the last write, persist it. */
async function save() {
  let text
  try {
    text = await readFile(snapshotPath, 'utf8')
  } catch {
    return // file missing/unreadable (game not running yet) — wait for the next event
  }
  if (text === last) return // unchanged — the mod re-touched the file with no new state
  last = text

  // Best-effort metadata for the filename + log; save the raw text even if it
  // doesn't parse (never drop data over a transient half-written read).
  let frame = 'naaaaaaa'
  let wands = 0
  let spells = 0
  try {
    const s = JSON.parse(text)
    frame = String(s.timestamp ?? 0).padStart(8, '0')
    wands = s.wands?.length ?? 0
    spells =
      (s.wands ?? []).reduce((n, w) => n + (w.spells ?? []).filter(Boolean).length, 0) +
      (s.spell_inventory?.length ?? 0)
  } catch {
    /* keep going — raw bytes are still worth saving */
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(outDir, `cap_${frame}_${stamp}.json`)
  await writeFile(file, text)
  count += 1
  console.log(`[record] #${count} frame=${frame} wands=${wands} spells=${spells} -> ${basename(file)}`)
}

console.log(`[record] watching ${snapshotPath}\n[record] saving distinct snapshots -> ${outDir}`)
await save() // capture whatever is already on disk right now

chokidar
  .watch(snapshotPath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }, // mod writes whole-file
  })
  .on('add', save)
  .on('change', save)
