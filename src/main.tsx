import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { runStore } from './store/runStore'
import { uiStore } from './store/uiStore'
import { analyzeWand } from './analysis'

// Dev-only observability hook: expose the live run + generation stores (and the
// analyzeWand entry point) on window so an external monitor (Playwright `evaluate`)
// can read the full per-archetype build suggestions in one call — and run scorer
// counterfactuals (e.g. self-danger with/without a perk) — without scraping the DOM.
// Stripped from prod builds by the DEV guard; read-only — never mutates app behavior.
if (import.meta.env.DEV) {
  ;(window as unknown as { __wand: unknown }).__wand = { runStore, uiStore, analyzeWand }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
