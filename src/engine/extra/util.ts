import {
  Random as RandomExt,
  SetRandomSeed as SetRandomSeedExt,
} from './random';
import { engineConfig } from '../config';

export function Random(min: number, max: number) {
  return RandomExt(min, max);
}

export function SetRandomSeed(a: number, b: number) {
  SetRandomSeedExt(engineConfig.worldSeed, a, b);
}

export function GameGetFrameNum() {
  return engineConfig.frameNumber;
}
