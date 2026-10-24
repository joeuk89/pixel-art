import { crossfadeLoop, envelope, seamReport, type Wav } from "./audio.ts";

export const TRIM_SEC = 8;
export const START_SEARCH_SEC = 15;
export const MIN_LOOP_SEC = 105;
export const MAX_LOOP_SEC = 115;
export const FADE_SEC = 4;

export type Seam = { seamJump: number; maxInnerJump: number };

export type MusicLoop = {
  loop: Wav;
  regionStartSec: number;
  regionEndSec: number;
  loopSamples: number;
  pickCost: number;
  seam: Seam;
};

// The wrap may add no sample step larger than the music already makes inside the loop.
export function seamPasses(seam: Seam): boolean {
  return seam.seamJump <= seam.maxInnerJump;
}

function pickRegion(w: Wav): { start: number; end: number; cost: number } {
  const { env, hop } = envelope(w), hps = 20;
  const trim = TRIM_SEC * hps, cmp = FADE_SEC * hps;
  let best = { cost: Infinity, s: 0, e: 0 };
  for (let s = trim; s < trim + START_SEARCH_SEC * hps; s++) {
    for (let e = s + MIN_LOOP_SEC * hps; e <= s + MAX_LOOP_SEC * hps; e++) {
      if (e + cmp >= env.length - trim) break;
      let cost = 0;
      for (let k = 0; k < cmp; k++) cost += Math.abs(env[s + k] - env[e + k]);
      // Prefer similar envelopes and quiet seams.
      cost = cost / cmp + 0.5 * (env[s] + env[e]);
      if (cost < best.cost) best = { cost, s, e };
    }
  }
  if (!isFinite(best.cost)) throw new Error(`source of ${(w.data[0].length / w.rate).toFixed(1)} s is too short for a ${MIN_LOOP_SEC} s loop`);
  return { start: best.s * hop, end: best.e * hop, cost: best.cost };
}

export function makeMusicLoop(w: Wav): MusicLoop {
  const { start, end, cost } = pickRegion(w);
  const loop = crossfadeLoop(w, start, end, FADE_SEC);
  return {
    loop,
    regionStartSec: +(start / w.rate).toFixed(3),
    regionEndSec: +(end / w.rate).toFixed(3),
    loopSamples: end - start,
    pickCost: +cost.toFixed(5),
    seam: seamReport(loop),
  };
}
