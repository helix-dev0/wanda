import { describe, it, expect } from 'vitest'
import { TEMPLATE_COPY, FEATURE_COPY, EDIT_KIND_COPY } from './copy'
import { TEMPLATES } from './templates'

// The Record<…> types already force exhaustiveness at compile time; these are the
// runtime backstop so adding a template/feature/edit-kind without copy fails loudly.
describe('dial copy — exhaustive over templates / features / edit kinds', () => {
  it('has copy for every template id', () => {
    for (const t of TEMPLATES) expect(TEMPLATE_COPY[t.id]).toBeTruthy()
  })

  it('has copy for every spell feature', () => {
    const features = ['DIG', 'MOBILITY', 'DEFENSIVE', 'HOMING', 'MULTICAST', 'TRIGGER', 'NUKE'] as const
    for (const f of features) expect(FEATURE_COPY[f]).toBeTruthy()
  })

  it('has copy for every edit kind', () => {
    for (const k of ['swap', 'remove', 'reorder'] as const) expect(EDIT_KIND_COPY[k]).toBeTruthy()
  })
})
