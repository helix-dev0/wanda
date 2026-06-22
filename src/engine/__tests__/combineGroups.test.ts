import { describe, it, expect } from 'vitest'
import { combineGroups } from '../util/combineGroups'

// Characterization test for combineGroups — the engine's consecutive-run
// grouper used by condense (cast-tree display). It had NO coverage upstream,
// which is why a missing dependency went unnoticed; this also guards the
// lodash `_.isEqual` -> fast-deep-equal swap by exercising the deep-equality path.
describe('combineGroups (engine util — deep-equality grouping)', () => {
  it('collapses repeated primitives into a counted group', () => {
    expect(combineGroups([1, 1, 1])).toEqual([{ first: 1, count: 3 }])
  })

  it('groups deeply-equal objects and separates an unequal one', () => {
    expect(combineGroups([{ x: 1 }, { x: 1 }, { x: 2 }])).toEqual([
      { first: { x: 1 }, count: 2 },
      { x: 2 },
    ])
  })

  it('leaves a non-repeating sequence untouched', () => {
    expect(combineGroups([1, 2, 3])).toEqual([1, 2, 3])
  })
})
