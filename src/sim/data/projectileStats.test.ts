import { describe, it, expect } from 'vitest'
import {
  getProjectileStats,
  projectileStatsTable,
  DAMAGE_UNIT_HP,
} from './projectileStats'

// Characterization: the generated table must reproduce real Noita projectile
// values (from data/entities/projectiles/**). These are the source-of-truth
// numbers the wiki + game XMLs confirm; a regen that changes them is a regression.
const P = 'data/entities/projectiles/'

describe('projectileStats table — known game values', () => {
  it('light_bullet (Spark Bolt): 0.12 internal = 3 HP', () => {
    const s = getProjectileStats(`${P}deck/light_bullet.xml`)!
    expect(s.damage).toBe(0.12)
    expect(s.damage * DAMAGE_UNIT_HP).toBeCloseTo(3)
    expect(s.explosionDamage).toBe(0)
  })

  it('rubber_ball: 0.12 dmg, 10 bounces', () => {
    const s = getProjectileStats(`${P}deck/rubber_ball.xml`)!
    expect(s.damage).toBe(0.12)
    expect(s.bouncesLeft).toBe(10)
  })

  it('bubbleshot: 0.2 dmg, 20 bounces', () => {
    const s = getProjectileStats(`${P}deck/bubbleshot.xml`)!
    expect(s.damage).toBe(0.2)
    expect(s.bouncesLeft).toBe(20)
  })

  it('grenade: direct 1.3 + explosion 1.9 / radius 7 + fire damage_by_type (nested parse)', () => {
    const s = getProjectileStats(`${P}deck/grenade.xml`)!
    expect(s.damage).toBe(1.3)
    expect(s.explosionDamage).toBe(1.9)
    expect(s.explosionRadius).toBe(7)
    expect(s.damageByType).toEqual({ fire: 0.5 })
  })

  it('nuke: direct 3 + explosion 10 / radius 250', () => {
    const s = getProjectileStats(`${P}deck/nuke.xml`)!
    expect(s.damage).toBe(3)
    expect(s.explosionDamage).toBe(10)
    expect(s.explosionRadius).toBe(250)
  })

  it('bomb: pure-explosion (0 direct, 5 explosion / radius 60)', () => {
    const s = getProjectileStats(`${P}bomb.xml`)!
    expect(s.damage).toBe(0)
    expect(s.explosionDamage).toBe(5)
    expect(s.explosionRadius).toBe(60)
  })
})

describe('projectileStats — pierce / collision flags (S1 prerequisite for AOE coverage)', () => {
  // penetrate_entities = passes through enemy bodies (innate, not modifier-added);
  // on_collision_die = dies on terrain contact. Both verified against the game XMLs.
  it('penetrating projectiles read penetrateEntities=true', () => {
    expect(getProjectileStats(`${P}deck/chain_bolt.xml`)!.penetrateEntities).toBe(true)
    expect(getProjectileStats(`${P}deck/black_hole.xml`)!.penetrateEntities).toBe(true)
  })

  it('a normal projectile is non-penetrating and dies on collision', () => {
    const rb = getProjectileStats(`${P}deck/rubber_ball.xml`)!
    expect(rb.penetrateEntities).toBe(false) // penetrate_entities absent → default false
    expect(rb.diesOnCollision).toBe(true) // on_collision_die="1"
  })

  it('black hole does not die on collision (on_collision_die=0) yet penetrates', () => {
    const bh = getProjectileStats(`${P}deck/black_hole.xml`)!
    expect(bh.diesOnCollision).toBe(false)
    expect(bh.penetrateEntities).toBe(true)
  })
})

describe('projectileStats lookup', () => {
  it('is a non-trivial table', () => {
    expect(Object.keys(projectileStatsTable).length).toBeGreaterThan(300)
  })

  it('returns undefined for an unknown (e.g. modded) entity path', () => {
    expect(getProjectileStats('data/entities/projectiles/deck/zzz_modded.xml')).toBeUndefined()
  })

  it('DAMAGE_UNIT_HP is the documented 25 HP per internal unit', () => {
    expect(DAMAGE_UNIT_HP).toBe(25)
  })
})
