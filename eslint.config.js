import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  // `.claude/` holds session scratch + isolated review WORKTREES (full repo copies).
  // Without this, `npm run lint` descends into a live worktree and reports hundreds of
  // phantom errors against the duplicated source. Never our code to lint.
  globalIgnores(['.claude']),
  // Tauri build artifacts (Rust target dir) — generated bundled JS/assets, not
  // app source. Present only after `npm run tauri build`; ignored so a local
  // native build doesn't make `npm run lint` fail on minified codegen output.
  globalIgnores(['src-tauri/target']),
  // src/engine is a VENDORED fork of salinecitrine/noita-wand-simulator's
  // calc/ engine (+ its build-time-generated tables and ported tests). Third-
  // party code is not held to our house style, so it is exempt from lint.
  // Exception: src/engine/config.ts is house-authored (the redux->config shim)
  // and stays linted. See src/engine/README.md.
  // (Negation pattern per ESLint flat-config docs: ignore contents, re-allow
  // descent into subdirectories, then un-ignore the one house-authored file.)
  globalIgnores([
    'src/engine/**/*',
    '!src/engine/**/*/',
    '!src/engine/config.ts',
  ]),
  // Mechanical, build-time-generated projectile-stats table (from the game's
  // projectile XMLs via scripts/generate-projectile-stats.mjs). Not house code.
  globalIgnores(['src/sim/data/projectileStats.generated.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
])
