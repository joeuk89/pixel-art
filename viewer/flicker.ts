import { fnv1a } from "./compositor.ts";
import { random } from "./random.ts";

export const FLICKER_FPS = 10;
// The deepest fifth of the swing: a lamp tuned by eye at depth 0.15 read as dipping below brightness 0.88.
const DIP = 0.8;

export type FlickerBlock = { depth: number; rate: number };
export type Flicker = { brightness(tick: number): number; dips(tick: number): boolean };

export function flickerTick(timeMs: number): number {
  return Math.floor((timeMs * FLICKER_FPS) / 1000);
}

export function createFlicker({ depth, rate }: FlickerBlock, seed: number, lightId: string): Flicker {
  const salt = fnv1a(lightId);
  const noise = (u: number, octave: number) => {
    const k = Math.floor(u);
    const f = u - k;
    const s = f * f * (3 - 2 * f);
    return random(seed, salt, octave, k, 0) * (1 - s) + random(seed, salt, octave, k + 1, 0) * s;
  };
  const swing = (tick: number) => {
    const u = (tick / FLICKER_FPS) * rate;
    return 0.75 * noise(u, 0) + 0.25 * noise(3 * u, 1);
  };
  return {
    brightness: (tick) => 1 - depth * swing(tick),
    dips: (tick) => depth > 0 && swing(tick) > DIP,
  };
}
