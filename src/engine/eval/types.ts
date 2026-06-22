import type { Action, GunActionState } from '../extra/types';
import type { GroupedObject } from '../util/combineGroups';

export type WandShot = {
  projectiles: Projectile[];
  calledActions: ActionCall[];
  actionTree: TreeNode<ActionCall>[];
  castState?: GunActionState;
  manaDrain?: number;
};

export type GroupedWandShot = {
  projectiles: GroupedObject<GroupedProjectile>[];
  calledActions: GroupedObject<ActionCall>[];
  actionTree: TreeNode<ActionCall>[];
  castState?: GunActionState;
  manaDrain?: number;
};

export type Projectile = {
  entity: string;
  action?: Action;
  proxy?: Action;
  trigger?: WandShot;
  deckIndex?: string | number;
};

export type GroupedProjectile = {
  entity: string;
  action?: Action;
  proxy?: Action;
  trigger?: GroupedWandShot;
  deckIndex?: string | number;
};

// Ported from `enum ActionSource` -> erasable const object + union type to
// satisfy `erasableSyntaxOnly`. Runtime values and the `ActionSource` type are
// identical to the original string enum (ActionSource.DRAW === 'draw', etc.).
export const ActionSource = {
  DRAW: 'draw',
  ACTION: 'action',
  PERK: 'perk',
  MULTIPLE: 'multiple',
} as const;

export type ActionSource = (typeof ActionSource)[keyof typeof ActionSource];

export type ActionCall = {
  action: Action;
  source: ActionSource;
  currentMana: number;
  deckIndex?: string | number;
  recursion?: number;
  iteration?: number;
  dont_draw_actions?: boolean;
};

export type TreeNode<T> = {
  value: T;
  parent?: TreeNode<T>;
  children: TreeNode<T>[];
};

export type Requirements = {
  enemies: boolean;
  projectiles: boolean;
  hp: boolean;
  half: boolean;
};
