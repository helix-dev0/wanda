// M5 — the dial's curated, DETERMINISTIC teaching copy. The dial is a presentation
// layer (spec §6.5): the engine computes the build + its reasons; this library
// supplies the mechanic "why" the Teach/Prescribe rungs compose with the wand's
// own M4 reasons[]. No runtime LLM → every line is fixed, exhaustive, and testable.

import type { TemplateId } from './types'
import type { SpellFeature } from '../analysis/features/spellFeatures'
import type { Edit } from '../analysis/suggestions'

/** Why each template's shape works — the Teach-rung explanation for a build. */
export const TEMPLATE_COPY: Record<TemplateId, string> = {
  'single-nuke': 'One big nuke carries the damage; modifiers placed before it stack onto that single hit.',
  'trigger-payload':
    'A trigger fires a second spell on impact — the payload goes right after it in the deck.',
  'multicast-stack':
    'A multicast draws several spells at once and throws them together — burst damage and spread.',
  'multiplicative-stack':
    'Damage modifiers sit before a multicast, so one copy of each boosts every spell it draws at once — the multiplier stacks instead of adding.',
  'cheap-shot-spam':
    'Each cheap shot is paired with a damage modifier — a flat bonus helps a weak spell most, and it fires fast.',
  spammer: 'Cheap, fast projectiles fired continuously — low mana per shot keeps it going.',
  'feature-fill':
    'Built around your digging spells — what terrain it can break, and whether it can dig continuously, matter more than raw damage here.',
  exhaustive:
    'The best arrangement of your spells, found by simulating every combination — not a fixed template.',
}

/** What each spell feature does — used in Teach/Prescribe to explain a build. */
export const FEATURE_COPY: Record<SpellFeature, string> = {
  DIG: 'digs through terrain',
  MOBILITY: 'moves you (teleport / levitation)',
  DEFENSIVE: 'shields or protects you',
  HOMING: 'steers toward enemies',
  MULTICAST: 'casts several spells at once',
  TRIGGER: 'fires a follow-up spell on impact',
  NUKE: 'one massive explosion',
}

/** What a polish edit accomplished — the Suggest/Prescribe "what we changed" note. */
export const EDIT_KIND_COPY: Record<Edit['kind'], string> = {
  swap: 'swapped in a stronger spell',
  remove: 'dropped a spell to fire faster',
  reorder: 'reordered the deck for a better cast sequence',
}

export function templateWhy(id: TemplateId): string {
  return TEMPLATE_COPY[id]
}

export function featureWhy(f: SpellFeature): string {
  return FEATURE_COPY[f]
}

export function editWhy(kind: Edit['kind']): string {
  return EDIT_KIND_COPY[kind]
}
