import { gateStill, type Pixels } from "./quality-gate.ts";

export const MIN_MOTION = 0.01;
export const MAX_DRIFT = 0.1;
export const MAX_SEAM_RATIO = 1.5;

type Lab = [number, number, number];

const linear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

function oklab(r: number, g: number, b: number): Lab {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const rgbOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255] as const;
};

export type Snapped = { frame: Pixels; opaque: number; offPalette: number };

export function snapToPalette(frame: Pixels, palette: string[]): Snapped {
  const colours = palette.map(rgbOf);
  const labs = colours.map(([r, g, b]) => oklab(r, g, b));
  const exact = new Set(palette.map((hex) => parseInt(hex.slice(1), 16)));
  const nearest = new Map<number, readonly [number, number, number]>();
  const data = new Uint8Array(frame.data);
  let opaque = 0, offPalette = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    opaque++;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    if (exact.has(key)) continue;
    offPalette++;
    let hit = nearest.get(key);
    if (!hit) {
      const [l, a, b] = oklab(data[i], data[i + 1], data[i + 2]);
      let best = 0, bestDistance = Infinity;
      labs.forEach(([pl, pa, pb], k) => {
        const d = (l - pl) ** 2 + (a - pa) ** 2 + (b - pb) ** 2;
        if (d < bestDistance) { bestDistance = d; best = k; }
      });
      hit = colours[best];
      nearest.set(key, hit);
    }
    data.set(hit, i);
  }
  return { frame: { width: frame.width, height: frame.height, data }, opaque, offPalette };
}

export function buildStrip(frames: Pixels[]): Pixels {
  const width = frames.reduce((sum, f) => sum + f.width, 0);
  const height = Math.max(0, ...frames.map((f) => f.height));
  const data = new Uint8Array(width * height * 4);
  let left = 0;
  for (const f of frames) {
    for (let y = 0; y < f.height; y++) data.set(f.data.subarray(y * f.width * 4, (y + 1) * f.width * 4), (y * width + left) * 4);
    left += f.width;
  }
  return { width, height, data };
}

// Share of the pixels opaque in either frame whose opacity or colour differs, as the looping-props prototype measured motion.
export function changedShare(a: Pixels, b: Pixels): number {
  let changed = 0, opaque = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const oa = a.data[i + 3] !== 0, ob = b.data[i + 3] !== 0;
    if (!oa && !ob) continue;
    opaque++;
    if (oa !== ob || a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) changed++;
  }
  return opaque === 0 ? 0 : changed / opaque;
}

export type StripGateInput = { width: number; height: number; frames: number; palette: string[]; offPaletteBefore: number };
export type StripGateReport = {
  ok: boolean;
  passed: string[];
  failed: string[];
  warnings: string[];
  measurements: { width: number; height: number; frames: number; steps: number[]; meanStep: number; drift: number; seam: number; offPaletteBefore: number };
};

const pct = (share: number) => `${Math.round(share * 10000) / 100}%`;
const round = (n: number) => Math.round(n * 10000) / 10000;

export function gateStrip(frames: Pixels[], input: StripGateInput): StripGateReport {
  const { width, height } = input;
  const strip = buildStrip(frames);
  const passed: string[] = [], failed: string[] = [], warnings: string[] = [];
  const check = (name: string, problems: string[]) => (problems.length === 0 ? passed.push(name) : failed.push(`${name}: ${problems.join("; ")}`));

  const sized = frames.every((f) => f.width === width && f.height === height);
  check("dimensions", frames.length === input.frames && sized
    ? []
    : [`${frames.length} frames making ${strip.width}x${strip.height}, expected ${input.frames} frames making ${input.frames * width}x${height}`]);

  const stillFails = (name: string) => frames.flatMap((f, k) => {
    const gate = gateStill(f, { kind: "backdrop", canvas: { width, height }, palette: input.palette });
    return gate.failed.filter((why) => why.startsWith(`${name}:`)).map((why) => `frame ${k} ${why.slice(name.length + 2)}`);
  });
  check("alpha", stillFails("alpha"));
  check("palette", stillFails("palette"));

  const comparable = sized && frames.length >= 2;
  const steps = comparable ? frames.slice(1).map((f, k) => changedShare(frames[k], f)) : [];
  const meanStep = steps.length ? steps.reduce((s, v) => s + v, 0) / steps.length : 0;
  const last = frames[frames.length - 1];
  const drift = comparable ? changedShare(frames[0], last) : 0;
  const seam = comparable ? changedShare(last, frames[0]) : 0;

  check("motion", comparable
    ? steps.flatMap((s, k) => (s < MIN_MOTION ? [`step ${k} to ${k + 1} moves ${pct(s)} of opaque pixels, under ${pct(MIN_MOTION)}`] : []))
    : ["needs at least two frames of the right size"]);
  check("drift", !comparable || drift <= MAX_DRIFT ? [] : [`last frame differs from frame 0 by ${pct(drift)}, over ${pct(MAX_DRIFT)}`]);
  check("seam", !comparable || seam <= MAX_SEAM_RATIO * meanStep
    ? []
    : [`seam ${pct(seam)} is over ${MAX_SEAM_RATIO}x the mean step ${pct(meanStep)}`]);
  if (input.offPaletteBefore > 0) warnings.push(`${pct(input.offPaletteBefore)} of opaque pixels were off the Palette before snapping`);

  return {
    ok: failed.length === 0,
    passed,
    failed,
    warnings,
    measurements: {
      width: strip.width, height: strip.height, frames: frames.length,
      steps: steps.map(round), meanStep: round(meanStep), drift: round(drift), seam: round(seam), offPaletteBefore: round(input.offPaletteBefore),
    },
  };
}
