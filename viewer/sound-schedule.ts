import { random } from "./random.ts";

export const DISTANCE_BUSES = {
  near: { gain: 0.7 },
  mid: { gain: 0.35, lowpassHz: 5000 },
  far: { gain: 0.15, lowpassHz: 1200 },
} as const;

const ONESHOT_SALT = 0x0e5407;
const LOOP_SALT = 0x100f;
const GAIN_JITTER_DB = 2;
const RATE_JITTER = 0.03;

export type Fire = { at: number; gain: number; rate: number };

export function* oneshotFires(seed: number, index: number, [min, max]: readonly [number, number]): Generator<Fire, never> {
  let at = 0;
  for (let k = 0; ; k++) {
    at += min + random(seed, ONESHOT_SALT, index, k, 0) * (max - min);
    const db = (random(seed, ONESHOT_SALT, index, k, 1) * 2 - 1) * GAIN_JITTER_DB;
    const rate = 1 + (random(seed, ONESHOT_SALT, index, k, 2) * 2 - 1) * RATE_JITTER;
    yield { at, gain: 10 ** (db / 20), rate };
  }
}

export function loopOffset(seed: number, index: number, durationSec: number): number {
  return random(seed, LOOP_SALT, index, 0, 0) * durationSec;
}
