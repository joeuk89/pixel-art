import { mix } from "./compositor.ts";

// Counter-based, so any draw can be computed from the seed and its indices alone without replaying earlier ones.
export function random(seed: number, a: number, b: number, c: number, d: number): number {
  let h = mix(seed ^ 0x9e3779b9);
  h = mix(h ^ Math.imul(a | 0, 0x27d4eb2f));
  h = mix(h ^ Math.imul(b | 0, 0x165667b1));
  h = mix(h ^ Math.imul(c | 0, 0x85ebca77));
  h = mix(h ^ Math.imul(d | 0, 0xc2b2ae3d));
  return h / 4294967296;
}
