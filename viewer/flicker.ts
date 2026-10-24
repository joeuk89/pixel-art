import { random } from "./random.ts";

export const FLICKER_FPS = 10;
// The palette-lighting prototype dipped the lamp at brightness 0.88 under depth 0.15: the deepest fifth of the swing.
const DIP = 0.8;

export type FlickerBlock = { depth: number; rate: number };
export type Flicker = { brightness(tick: number): number; dips(tick: number): boolean };

function textSalt(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h;
}

export function flickerTick(timeMs: number): number {
  return Math.floor((timeMs * FLICKER_FPS) / 1000);
}

export function createFlicker({ depth, rate }: FlickerBlock, seed: number, lightId: string): Flicker {
  const salt = textSalt(lightId);
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
