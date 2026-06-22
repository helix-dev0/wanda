// Engine config — replaces the app's Redux store coupling.
//
// The upstream engine (salinecitrine/noita-wand-simulator) read two values out
// of its Redux store in `extra/util.ts`:
//   store.getState().config.config.random.worldSeed
//   store.getState().config.config.random.frameNumber
// These seed Noita's deterministic RNG (SetRandomSeed / GameGetFrameNum).
//
// We vendor that coupling away into this tiny mutable module so the engine has
// no framework dependency. Callers (the app) set these before simulating a wand
// when determinism vs. the live game matters; both default to 0.

export type EngineConfig = {
  worldSeed: number
  frameNumber: number
}

export const engineConfig: EngineConfig = {
  worldSeed: 0,
  frameNumber: 0,
}

export function setEngineConfig(config: Partial<EngineConfig>): void {
  if (config.worldSeed !== undefined) {
    engineConfig.worldSeed = config.worldSeed
  }
  if (config.frameNumber !== undefined) {
    engineConfig.frameNumber = config.frameNumber
  }
}
