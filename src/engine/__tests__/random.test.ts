import { beforeEach, it, expect } from 'vitest';
// NOTE: upstream imported `random_seed` here too but never used it; dropped to
// satisfy our `noUnusedLocals`. Test logic is unchanged.
import { Random } from '../extra/random';
import { SetRandomSeed } from '../extra/util';

beforeEach(() => {
  SetRandomSeed(0, 100);
});

it('random', () => {
  expect(Random(5, 5)).toEqual(5);
});
