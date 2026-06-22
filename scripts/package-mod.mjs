// Package the Noita capture mod into wand-capture-mod.zip for the GitHub Release.
// The archive extracts to a SINGLE top-level folder named `wand_capture` — the modid the
// Lua hardcodes (mod/init.lua: dofile_once("mods/wand_capture/EZWand.lua")); any other
// folder name breaks the mod's internal require paths.
//
// Usage: node scripts/package-mod.mjs [outDir]   (outDir defaults to the repo root)
// Uses adm-zip (pure JS) so it runs identically on Linux/CI without a system `zip`.

import AdmZip from 'adm-zip'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const modDir = join(repo, 'mod')
const outDir = resolve(process.argv[2] ?? repo)
const outFile = join(outDir, 'wand-capture-mod.zip')

mkdirSync(outDir, { recursive: true })

const zip = new AdmZip()
// addLocalFolder(srcDir, zipPath) nests every file under `wand_capture/` in the archive.
zip.addLocalFolder(modDir, 'wand_capture')
zip.writeZip(outFile)

const entries = zip.getEntries().map((e) => e.entryName).sort()
console.log(`wrote ${outFile} (${entries.length} entries)`)
for (const e of entries) console.log('  ' + e)
