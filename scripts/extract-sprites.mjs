// One-time asset prep — enrich the bundled vanilla spell/perk DBs with real game
// icons, OFFLINE (no running game, no mod). Reads sprite PNG bytes straight out of
// Noita's `data.wak` archive and writes a base64 `sprite_base64` onto each DB entry
// — exactly the field the app already renders (viewModel.resolveSpriteSrc / SpellTile)
// and the same transport the M1 mod will emit live. This is the "vanilla snapshot
// bundled as fallback" (spec invariant #5); the mod overrides it per-version/modded.
//
// Usage:  node scripts/extract-sprites.mjs [path/to/data.wak]
//   path resolution: argv[2] → $NOITA_DATA_WAK → per-OS Steam defaults (invariant #8).
//
// data.wak format (reverse-engineered + verified): u32 at offset 8 = start of the
// data section; entries from offset 16, each [u32 offset][u32 size][u32 nameLen]
// [name bytes]; file bytes live at `offset` for `size` bytes.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(root, 'src/data/fixtures')

function findWak() {
  const candidates = [
    process.argv[2],
    process.env.NOITA_DATA_WAK,
    join(homedir(), '.local/share/Steam/steamapps/common/Noita/data/data.wak'), // Linux + Proton
    join(homedir(), '.steam/steam/steamapps/common/Noita/data/data.wak'),
    'C:/Program Files (x86)/Steam/steamapps/common/Noita/data/data.wak', // Windows
  ].filter(Boolean)
  const hit = candidates.find((p) => existsSync(p))
  if (!hit) {
    console.error('data.wak not found. Pass its path:\n  node scripts/extract-sprites.mjs <path/to/data.wak>')
    process.exit(1)
  }
  return hit
}

/** Parse the wak index into a Map<path, Buffer of file bytes>. */
function readWak(wakPath) {
  const buf = readFileSync(wakPath)
  const dataStart = buf.readUInt32LE(8)
  const files = new Map()
  let pos = 16
  while (pos < dataStart) {
    const offset = buf.readUInt32LE(pos)
    const size = buf.readUInt32LE(pos + 4)
    const nameLen = buf.readUInt32LE(pos + 8)
    const name = buf.toString('latin1', pos + 12, pos + 12 + nameLen)
    pos += 12 + nameLen
    files.set(name, buf.subarray(offset, offset + size))
  }
  return files
}

/** Set sprite_base64 on each entry whose `pathField` resolves to a PNG in the wak. */
function enrich(dbFile, pathField, files) {
  const path = join(FIXTURES, dbFile)
  const db = JSON.parse(readFileSync(path, 'utf8'))
  let hit = 0
  const missing = []
  for (const entry of db) {
    const sprite = entry[pathField]
    if (typeof sprite !== 'string') continue
    const png = files.get(sprite)
    if (png && png.length >= 8 && png.readUInt32BE(0) === 0x89504e47) {
      entry.sprite_base64 = png.toString('base64')
      hit++
    } else {
      missing.push(entry.id)
    }
  }
  writeFileSync(path, JSON.stringify(db))
  console.log(`${dbFile}: ${hit}/${db.length} icons embedded` + (missing.length ? ` (no png for ${missing.length}: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''})` : ''))
}

const wak = findWak()
console.log('reading', wak)
const files = readWak(wak)
console.log(`indexed ${files.size} files`)
enrich('spell_db.json', 'sprite', files)
enrich('perk_db.json', 'ui_icon', files)
