import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
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
