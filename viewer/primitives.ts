import { activePrimitives, placementsOf, primitiveSchema, SCENE_HEIGHT, SCENE_WIDTH, type Palette, type Placement, type Primitive, type ScenePlan, type Variant } from "../schema/index.ts";
import { mix, placedXs, step, type ElementPixels, type Pixels, type PrimitiveDraw } from "./compositor.ts";
import { positioned, type Positioned } from "./placement.ts";
import { random } from "./random.ts";

export const WEATHER_FPS = 24;
export const PROP_FPS = 10;

export type PrimitivesInput = { plan: ScenePlan; elements: ReadonlyMap<string, ElementPixels>; palette: Palette; seed?: number; variant?: Variant; features?: ReadonlyMap<string, Pixels> };

type Of<T extends Primitive["type"]> = Extract<Primitive, { type: T }>;
type Context = {
  seed: number;
  salt: number;
  colours: Colours;
  ramps: Palette["ramps"];
  anchor(id: string): { placement: Positioned; pixels: Pixels; layer: number };
  top: number;
};

type Colours = { r: Uint8Array; g: Uint8Array; b: Uint8Array; indexOf: Map<number, number> };

function coloursOf(palette: Palette): Colours {
  const n = palette.colours.length;
  const c: Colours = { r: new Uint8Array(n), g: new Uint8Array(n), b: new Uint8Array(n), indexOf: new Map() };
  palette.colours.forEach((hex, i) => {
    const v = parseInt(hex.slice(1), 16);
    c.r[i] = v >> 16;
    c.g[i] = (v >> 8) & 255;
    c.b[i] = v & 255;
    if (!c.indexOf.has(v)) c.indexOf.set(v, i);
  });
  return c;
}

function paint(out: Uint8ClampedArray, c: Colours, pixel: number, colour: number): void {
  const i = pixel * 4;
  out[i] = c.r[colour];
  out[i + 1] = c.g[colour];
  out[i + 2] = c.b[colour];
  out[i + 3] = 255;
}

function isColour(out: Uint8ClampedArray, c: Colours, pixel: number, colour: number): boolean {
  const i = pixel * 4;
  return out[i] === c.r[colour] && out[i + 1] === c.g[colour] && out[i + 2] === c.b[colour];
}

function plotIn(out: Uint8ClampedArray, c: Colours, region: { x: number; y: number; w: number; h: number }, x: number, y: number, colour: number): void {
  const x0 = Math.max(region.x, 0), y0 = Math.max(region.y, 0);
  const x1 = Math.min(region.x + region.w, SCENE_WIDTH), y1 = Math.min(region.y + region.h, SCENE_HEIGHT);
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return;
  paint(out, c, y * SCENE_WIDTH + x, colour);
}

function eachPlacedPixel(p: Positioned, src: Pixels, visit: (pixel: number, source: number) => void): void {
  for (const x0 of placedXs(p, src.width)) {
    for (let sy = 0; sy < src.height; sy++) {
      const y = p.y + sy;
      if (y < 0 || y >= SCENE_HEIGHT) continue;
      for (let sx = 0; sx < src.width; sx++) {
        const x = x0 + sx;
        if (x < 0 || x >= SCENE_WIDTH) continue;
        const source = sy * src.width + (p.flipX ? src.width - 1 - sx : sx);
        if (src.data[source * 4 + 3] < 128) continue;
        visit(y * SCENE_WIDTH + x, source);
      }
    }
  }
}

function sourceIndex(c: Colours, src: Pixels, source: number): number | undefined {
  const i = source * 4;
  return c.indexOf.get((src.data[i] << 16) | (src.data[i + 1] << 8) | src.data[i + 2]);
}

const GUST_LULL = 0.15;
const GUST_PEAK_MIN = 0.55;

// Wind from 0 to 1 against time in steps, smoothed through seeded knots that alternate lull and peak.
function gusts(seed: number, salt: number, period: number) {
  const half = (period * WEATHER_FPS) / 2;
  const at = (n: number) => (n + 0.4 * (random(seed, salt, -1, n, 0) - 0.5)) * half;
  const strength = (n: number) => (n & 1 ? GUST_PEAK_MIN + (1 - GUST_PEAK_MIN) * random(seed, salt, -1, n, 1) : GUST_LULL * random(seed, salt, -1, n, 1));
  const knotBefore = (t: number) => {
    let n = Math.floor(t / half) + 1;
    while (at(n) > t) n--;
    return n;
  };
  const smooth = (f: number) => f * f * (3 - 2 * f);
  const smoothArea = (f: number) => f * f * f - (f * f * f * f) / 2;
  return {
    at(t: number): number {
      const n = knotBefore(t), t0 = at(n), a = strength(n);
      return a + (strength(n + 1) - a) * smooth((t - t0) / (at(n + 1) - t0));
    },
    over(from: number, to: number): number {
      let sum = 0;
      for (let n = knotBefore(from), t = from; t < to; n++) {
        const t0 = at(n), t1 = at(n + 1), end = Math.min(to, t1), a = strength(n), rise = strength(n + 1) - a;
        const area = (time: number) => { const f = (time - t0) / (t1 - t0); return a * f + rise * smoothArea(f); };
        sum += (t1 - t0) * (area(end) - area(t));
        t = end;
      }
      return sum;
    },
  };
}

function rain(p: Of<"rain">, ctx: Context): PrimitiveDraw {
  const { seed, salt, colours: c } = ctx;
  const { region, colours, density, drift, gust } = p;
  const wind = gusts(seed, salt, p.gustPeriod);
  const speed = new Float64Array(density), length = new Uint8Array(density), period = new Uint32Array(density), phase = new Uint32Array(density);
  for (let k = 0; k < density; k++) {
    speed[k] = 1.6 + random(seed, salt, k, 0, 0) * 1.2;
    length[k] = 1 + Math.floor(random(seed, salt, k, 0, 1) * 2);
    period[k] = Math.ceil((region.h + 3) / speed[k]) + 1;
    phase[k] = Math.floor(random(seed, salt, k, 0, 2) * period[k]);
  }
  return {
    after: p.anchor ? ctx.anchor(p.anchor).layer : ctx.top,
    fps: WEATHER_FPS,
    draw(out, timeMs) {
      const s = step(timeMs, WEATHER_FPS);
      const push = gust ? gust * wind.at(s) : 0;
      for (let k = 0; k < density; k++) {
        const u = s + phase[k];
        const gen = Math.floor(u / period[k]);
        const local = u - gen * period[k];
        const blown = gust ? gust * wind.over(s - local, s) : 0;
        const x = Math.round(region.x - 4 + random(seed, salt, k, gen, 3) * (region.w + 8) + local * drift + blown);
        const y = Math.round(region.y - 3 + local * speed[k]);
        const highlight = colours.length > 1 && random(seed, salt, k, gen, 4) < 0.3;
        const colour = highlight ? colours[1 + Math.floor(random(seed, salt, k, gen, 5) * (colours.length - 1))] : colours[0];
        for (let j = 0; j < length[k]; j++) plotIn(out, c, region, x - Math.round(((length[k] - 1 - j) * push) / speed[k]), y + j, colour);
      }
    },
  };
}

const SNOW_SWAY_STEPS = 48;

function snow(p: Of<"snow">, ctx: Context): PrimitiveDraw {
  const { seed, salt, colours: c } = ctx;
  const { region, colours, density, drift, wind } = p;
  const speed = new Float64Array(density), period = new Uint32Array(density), phase = new Uint32Array(density), sway = new Float64Array(density);
  for (let k = 0; k < density; k++) {
    speed[k] = 0.25 + random(seed, salt, k, 0, 0) * 0.35;
    period[k] = Math.ceil((region.h + 2) / speed[k]) + 1;
    phase[k] = Math.floor(random(seed, salt, k, 0, 1) * period[k]);
    sway[k] = random(seed, salt, k, 0, 2);
  }
  return {
    after: p.anchor ? ctx.anchor(p.anchor).layer : ctx.top,
    fps: WEATHER_FPS,
    draw(out, timeMs) {
      const s = step(timeMs, WEATHER_FPS);
      for (let k = 0; k < density; k++) {
        const u = s + phase[k];
        const gen = Math.floor(u / period[k]);
        const local = u - gen * period[k];
        const across = random(seed, salt, k, gen, 3) * region.w + local * wind + drift * Math.sin(2 * Math.PI * (local / SNOW_SWAY_STEPS + sway[k]));
        const x = region.x + (((Math.round(across) % region.w) + region.w) % region.w);
        const y = Math.round(region.y - 1 + local * speed[k]);
        const colour = colours[Math.floor(random(seed, salt, k, gen, 4) * colours.length)];
        plotIn(out, c, region, x, y, colour);
      }
    },
  };
}

const STEAM_LIFE = 23;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function steam(p: Of<"steam">, ctx: Context): PrimitiveDraw {
  const { seed, salt, colours: c } = ctx;
  const { placement, layer } = ctx.anchor(p.anchor);
  const { colours, count } = p;
  const ox = placement.x + p.offset.x, oy = placement.y + p.offset.y;
  const phase = new Uint32Array(count);
  for (let k = 0; k < count; k++) phase[k] = Math.floor(random(seed, salt, k, 0, 0) * STEAM_LIFE);
  const dot = (out: Uint8ClampedArray, x: number, y: number, alpha: number, colour: number) => {
    if (x < 0 || x >= SCENE_WIDTH || y < 0 || y >= SCENE_HEIGHT) return;
    if (alpha * 16 <= BAYER[(y & 3) * 4 + (x & 3)] + 0.5) return;
    paint(out, c, y * SCENE_WIDTH + x, colour);
  };
  return {
    after: layer,
    fps: PROP_FPS,
    draw(out, timeMs) {
      const s = step(timeMs, PROP_FPS);
      for (let k = 0; k < count; k++) {
        const u = s + phase[k];
        const gen = Math.floor(u / STEAM_LIFE);
        const life = u - gen * STEAM_LIFE;
        if (life === 0) continue;
        const x0 = ox - 5 + random(seed, salt, k, gen, 1) * 10;
        const wobble = random(seed, salt, k, gen, 2) * 2 * Math.PI;
        const x = Math.round(x0 + Math.sin(life * 0.35 + wobble) * (1 + life * 0.06));
        const y = Math.round(oy - 0.7 * life);
        const alpha = life < 5 ? 0.4 : life < 15 ? 0.7 : 0.3;
        const colour = life < 10 ? colours[0] : colours[colours.length - 1];
        const size = life > 12 ? 2 : 1;
        for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) dot(out, x + dx, y + dy, alpha, colour);
      }
    },
  };
}

const TWINKLE_HOLD_STEPS = 5;

function twinkle(p: Of<"twinkle">, ctx: Context): PrimitiveDraw {
  const { seed, salt, colours: c } = ctx;
  const { placement, pixels, layer } = ctx.anchor(p.anchor);
  const lights = new Set(p.colours);
  const counts = new Map<number, number>();
  const at: number[] = [], was: number[] = [];
  eachPlacedPixel(placement, pixels, (pixel, source) => {
    const index = sourceIndex(c, pixels, source);
    if (index === undefined) return;
    if (lights.has(index)) {
      at.push(pixel);
      was.push(index);
    } else counts.set(index, (counts.get(index) ?? 0) + 1);
  });
  const dark = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
  const positions = Int32Array.from(at), original = Uint8Array.from(was);
  const { count } = p;
  const phase = new Uint32Array(count);
  for (let k = 0; k < count; k++) phase[k] = Math.floor(random(seed, salt, k, 0, 0) * TWINKLE_HOLD_STEPS);
  const picks = new Int32Array(count);
  const pickAll = (timeMs: number) => {
    const s = step(timeMs, PROP_FPS);
    for (let k = 0; k < count; k++) picks[k] = Math.floor(random(seed, salt, k, Math.floor((s + phase[k]) / TWINKLE_HOLD_STEPS), 1) * positions.length);
  };
  return {
    after: layer,
    fps: PROP_FPS,
    state(timeMs) {
      if (positions.length === 0) return 0;
      pickAll(timeMs);
      picks.sort();
      // Hashes the set of dimmed lights, so slots that roll onto the same lights cost no redraw.
      let h = 0x2545f491, l = 0x6a09e667;
      for (let k = 0; k < count; k++) {
        if (k > 0 && picks[k] === picks[k - 1]) continue;
        h = mix(h ^ picks[k]);
        l = mix(l ^ Math.imul(picks[k], 0x9e3779b1));
      }
      return (h & 0x1fffff) * 4294967296 + l;
    },
    draw(out, timeMs) {
      if (positions.length === 0) return;
      pickAll(timeMs);
      for (let k = 0; k < count; k++) if (isColour(out, c, positions[picks[k]], original[picks[k]])) paint(out, c, positions[picks[k]], dark);
    },
  };
}

function blink(p: Of<"blink">, ctx: Context): PrimitiveDraw {
  const { seed, salt, colours: c } = ctx;
  const { placement, pixels, layer } = ctx.anchor(p.anchor);
  const to = new Map(p.swaps.map(([from, into]) => [from, into]));
  const at: number[] = [], froms: number[] = [], intos: number[] = [];
  eachPlacedPixel(placement, pixels, (pixel, source) => {
    const index = sourceIndex(c, pixels, source);
    if (index === undefined || !to.has(index)) return;
    at.push(pixel);
    froms.push(index);
    intos.push(to.get(index)!);
  });
  const positions = Int32Array.from(at), from = Uint8Array.from(froms), into = Uint8Array.from(intos);
  const chance = p.rate / PROP_FPS;
  const [shortest, longest] = p.longFrames;
  const dropped = (s: number) => {
    for (let j = s; j > s - Math.max(1, longest); j--) {
      if (random(seed, salt, j, 0, 0) >= chance) continue;
      const long = random(seed, salt, j, 0, 1) < p.longShare;
      const length = long ? shortest + Math.floor(random(seed, salt, j, 0, 2) * (longest - shortest + 1)) : 1;
      if (s - j < length) return 1;
    }
    return 0;
  };
  return {
    after: layer,
    fps: PROP_FPS,
    state: (timeMs) => (positions.length === 0 ? 0 : dropped(step(timeMs, PROP_FPS))),
    draw(out, timeMs) {
      if (!dropped(step(timeMs, PROP_FPS))) return;
      for (let k = 0; k < positions.length; k++) if (isColour(out, c, positions[k], from[k])) paint(out, c, positions[k], into[k]);
    },
  };
}

const DUST_LIFE_STEPS = [40, 80] as const;

function dust(p: Of<"dust">, ctx: Context): PrimitiveDraw {
  const { seed, salt, colours: c } = ctx;
  const { region, colours, count } = p;
  const [shortest, longest] = DUST_LIFE_STEPS;
  const life = new Uint32Array(count), phase = new Uint32Array(count);
  for (let k = 0; k < count; k++) {
    life[k] = shortest + Math.floor(random(seed, salt, k, 0, 0) * (longest - shortest + 1));
    phase[k] = Math.floor(random(seed, salt, k, 0, 1) * life[k]);
  }
  return {
    after: p.anchor ? ctx.anchor(p.anchor).layer : ctx.top,
    fps: PROP_FPS,
    draw(out, timeMs) {
      const s = step(timeMs, PROP_FPS);
      for (let k = 0; k < count; k++) {
        const u = s + phase[k];
        const gen = Math.floor(u / life[k]);
        const local = u - gen * life[k];
        const level = Math.min(colours.length - 1, Math.floor(Math.sin((Math.PI * local) / life[k]) * (colours.length + 1)) - 1);
        if (level < 0) continue;
        const angle = random(seed, salt, k, gen, 2) * 2 * Math.PI;
        const speed = 0.03 + random(seed, salt, k, gen, 3) * 0.07;
        const x = Math.round(region.x + random(seed, salt, k, gen, 4) * region.w + Math.cos(angle) * speed * local);
        const y = Math.round(region.y + random(seed, salt, k, gen, 5) * region.h + Math.sin(angle) * speed * local);
        plotIn(out, c, region, x, y, colours[level]);
      }
    },
  };
}

const SWAY_ROWS_PER_WAVE = 24;

function sway(p: Of<"sway">, ctx: Context): PrimitiveDraw {
  const { seed, salt, colours: c } = ctx;
  const { placement, pixels, layer } = ctx.anchor(p.anchor);
  const { region, amplitude, rate } = p;
  const x0 = Math.max(region.x, 0), y0 = Math.max(region.y, 0);
  const x1 = Math.min(region.x + region.w, SCENE_WIDTH), y1 = Math.min(region.y + region.h, SCENE_HEIGHT);
  const leaves = new Set(p.colours);
  const leaf = new Uint8Array(SCENE_WIDTH * SCENE_HEIGHT);
  let any = false;
  eachPlacedPixel(placement, pixels, (pixel, source) => {
    const x = pixel % SCENE_WIDTH, y = Math.floor(pixel / SCENE_WIDTH);
    if (x < x0 || x >= x1 || y < y0 || y >= y1) return;
    const index = sourceIndex(c, pixels, source);
    if (index !== undefined && leaves.has(index)) (leaf[pixel] = 1), (any = true);
  });
  const phase = random(seed, salt, 0, 0, 0);
  const offsets = new Int8Array(Math.max(0, y1 - y0));
  const offsetsAt = (timeMs: number) => {
    const turn = (step(timeMs, PROP_FPS) / PROP_FPS) * rate + phase;
    for (let y = y0; y < y1; y++) offsets[y - y0] = Math.round(amplitude * Math.sin(2 * Math.PI * (turn + y / SWAY_ROWS_PER_WAVE)));
  };
  const row = new Uint8ClampedArray(SCENE_WIDTH * 4);
  return {
    after: layer,
    fps: PROP_FPS,
    state(timeMs) {
      if (!any) return 0;
      offsetsAt(timeMs);
      let h = 0x2545f491;
      for (let k = 0; k < offsets.length; k++) h = mix(h ^ (offsets[k] + 128 + (k << 8)));
      return h;
    },
    draw(out, timeMs) {
      if (!any) return;
      offsetsAt(timeMs);
      for (let y = y0; y < y1; y++) {
        const dx = offsets[y - y0];
        if (dx === 0) continue;
        row.set(out.subarray(y * SCENE_WIDTH * 4, (y + 1) * SCENE_WIDTH * 4));
        for (let x = x0; x < x1; x++) {
          const from = x - dx;
          if (from < 0 || from >= SCENE_WIDTH) continue;
          if (!leaf[y * SCENE_WIDTH + from] && !leaf[y * SCENE_WIDTH + x]) continue;
          out.set(row.subarray(from * 4, from * 4 + 4), (y * SCENE_WIDTH + x) * 4);
        }
      }
    },
  };
}

const BIRD_SPACING = 5;
const BIRD_FLAP_STEPS = 3;
const BIRD_WINGS = [[[-1, -1], [0, 0], [1, -1]], [[-1, 1], [0, 0], [1, 1]]] as const;

function birds(p: Of<"birds">, ctx: Context): PrimitiveDraw {
  const { seed, salt, colours: c } = ctx;
  const { region, colours, count } = p;
  const [min, max] = p.every;
  const slotSteps = ((min + max) / 2) * WEATHER_FPS;
  const jitterSteps = ((max - min) / 2) * WEATHER_FPS;
  const flockLength = (count - 1) * BIRD_SPACING + 2;
  const route = region.w + 2 * flockLength;
  const lookback = Math.ceil((jitterSteps + route / 0.7) / slotSteps);
  const rise = Math.ceil((count - 1) / 2) * 2;
  const flock = (timeMs: number, visit: (x: number, y: number, wings: number, colour: number) => void) => {
    const s = step(timeMs, WEATHER_FPS);
    const slot = Math.floor(s / slotSteps);
    for (let j = Math.max(0, slot - lookback); j <= slot; j++) {
      const local = s - Math.floor(j * slotSteps + random(seed, salt, j, 0, 0) * jitterSteps);
      const speed = 0.7 + random(seed, salt, j, 0, 1) * 0.3;
      const travel = local * speed;
      if (local < 0 || travel > route) continue;
      const leftward = random(seed, salt, j, 0, 2) < 0.5;
      const baseY = region.y + 1 + rise + Math.floor(random(seed, salt, j, 0, 3) * Math.max(1, region.h - 2 - 2 * rise));
      for (let b = 0; b < count; b++) {
        const along = Math.round(travel) - 2 - b * BIRD_SPACING;
        const x = leftward ? region.x + region.w - 1 - along : region.x + along;
        const y = baseY + (b % 2 === 1 ? -1 : 1) * Math.ceil(b / 2) * 2;
        const wings = Math.floor((local + b * 2) / BIRD_FLAP_STEPS) % 2;
        visit(x, y, wings, colours[Math.floor(random(seed, salt, j, b, 4) * colours.length)]);
      }
    }
  };
  return {
    after: p.anchor ? ctx.anchor(p.anchor).layer : ctx.top,
    fps: WEATHER_FPS,
    state(timeMs) {
      let h = 0;
      flock(timeMs, (x, y, wings, colour) => (h = mix(h ^ ((x + 64) | ((y + 64) << 9) | (wings << 18) | (colour << 19)))));
      return h;
    },
    draw(out, timeMs) {
      flock(timeMs, (x, y, wings, colour) => {
        for (const [dx, dy] of BIRD_WINGS[wings]) plotIn(out, c, region, x + dx, y + dy, colour);
      });
    },
  };
}

function pendulum(p: Of<"pendulum">, ctx: Context): PrimitiveDraw {
  const { seed, salt, colours: c } = ctx;
  const { region, pivot, length, bob, period } = p;
  const [rod, weight, highlight] = p.colours;
  const amplitude = (p.amplitude * Math.PI) / 180;
  const phase = random(seed, salt, 0, 0, 0);
  const bobAt = (timeMs: number) => {
    const angle = amplitude * Math.sin(2 * Math.PI * (step(timeMs, PROP_FPS) / PROP_FPS / period + phase));
    return { x: Math.round(length * Math.sin(angle)), y: Math.round(length * Math.cos(angle)) };
  };
  return {
    after: ctx.anchor(p.anchor).layer,
    fps: PROP_FPS,
    state(timeMs) {
      const { x, y } = bobAt(timeMs);
      return 1 + (x + 256) + ((y + 256) << 10);
    },
    draw(out, timeMs) {
      const { x: bx, y: by } = bobAt(timeMs);
      for (let dy = 0; dy <= by; dy++) plotIn(out, c, region, pivot.x + Math.round((dy * bx) / by), pivot.y + dy, rod);
      for (let dy = -bob; dy <= bob; dy++) {
        for (let dx = -bob; dx <= bob; dx++) {
          if (dx * dx + dy * dy > bob * bob + bob * 0.5) continue;
          plotIn(out, c, region, pivot.x + bx + dx, pivot.y + by + dy, weight);
        }
      }
      if (highlight !== undefined && bob >= 2) plotIn(out, c, region, pivot.x + bx - 1, pivot.y + by - 1, highlight);
    },
  };
}

const BOAT_LENGTHS = [3, 6] as const;
const BOAT_SPEED_SPREAD = 0.2;
const BOAT_PAUSE_SECONDS = 8;
const BOAT_FIRST_ENTRY_SECONDS = 10;

function boats(p: Of<"boats">, ctx: Context): PrimitiveDraw {
  const { seed, salt, colours: c } = ctx;
  const { region, count, speed } = p;
  const [hull, light] = p.colours;
  const [shortest, longest] = BOAT_LENGTHS;
  const band = region.h / count;
  // Each slot fits one crossing at the slowest speed plus a pause, so a boat never needs earlier slots.
  const slotSteps = Math.ceil(((region.w + longest) / (speed * (1 - BOAT_SPEED_SPREAD)) + BOAT_PAUSE_SECONDS) * WEATHER_FPS);
  const fleet = (timeMs: number, visit: (x0: number, y: number, length: number, leftward: boolean) => void) => {
    const s = step(timeMs, WEATHER_FPS);
    const slot = Math.floor(s / slotSteps);
    for (let k = 0; k < count; k++) {
      const length = shortest + Math.floor(random(seed, salt, k, slot, 0) * (longest - shortest + 1));
      const pace = (speed * (1 + BOAT_SPEED_SPREAD * (2 * random(seed, salt, k, slot, 1) - 1))) / WEATHER_FPS;
      const route = region.w + length;
      const slack = slotSteps - Math.ceil(route / pace);
      const delay = Math.floor(random(seed, salt, k, slot, 2) * (slot === 0 ? Math.min(slack, BOAT_FIRST_ENTRY_SECONDS * WEATHER_FPS) : slack));
      const travel = Math.floor((s - slot * slotSteps - delay) * pace);
      if (travel < 0 || travel >= route) continue;
      const leftward = random(seed, salt, k, slot, 3) < 0.5;
      const y = region.y + Math.min(region.h - 1, Math.floor(k * band + random(seed, salt, k, slot, 4) * band));
      const x0 = leftward ? region.x + region.w - travel : region.x - length + travel;
      visit(x0, y, length, leftward);
    }
  };
  return {
    after: p.anchor ? ctx.anchor(p.anchor).layer : ctx.top,
    fps: WEATHER_FPS,
    state(timeMs) {
      let h = 0;
      fleet(timeMs, (x0, y, length, leftward) => (h = mix(h ^ ((x0 + 64) | ((y + 64) << 10) | (length << 20) | (Number(leftward) << 23)))));
      return h;
    },
    draw(out, timeMs) {
      fleet(timeMs, (x0, y, length, leftward) => {
        for (let i = 0; i < length; i++) plotIn(out, c, region, x0 + i, y, hull);
        plotIn(out, c, region, leftward ? x0 : x0 + length - 1, y, light);
      });
    },
  };
}

const TRICKLE_HOLD_STEPS = 4 * WEATHER_FPS;
const TRICKLE_SLIDE_PX = 3.5;
const TRICKLE_HOP_STEPS = [8, 16] as const;
const TRICKLE_TRAIL_STEPS = 18;
// Share of its life after which a drying trail breaks up into every other pixel.
const TRICKLE_BEADING = 0.5;
const TRICKLE_FORM_STEPS = 10;
const TRICKLE_JOG = 0.15;
const TRICKLE_TALL = 0.35;

function trickle(p: Of<"trickle">, ctx: Context): PrimitiveDraw {
  const { seed, salt, colours: c } = ctx;
  const { region, colours, count, wind } = p;
  const bead = colours[colours.length - 1];
  const trail = colours.length > 1 ? colours.slice(0, -1) : colours;
  const bottom = region.y + region.h;
  const [quickest, slowest] = TRICKLE_HOP_STEPS;
  // A generation fits the longest run down the region after the shortest hold, so a bead never needs earlier generations.
  const longestRun = Math.ceil((region.h + 1) / TRICKLE_SLIDE_PX) * slowest;
  const period = new Uint32Array(count), phase = new Uint32Array(count);
  for (let k = 0; k < count; k++) {
    period[k] = Math.ceil((TRICKLE_HOLD_STEPS + longestRun + TRICKLE_TRAIL_STEPS) * (1 + 0.3 * random(seed, salt, k, 0, 0)));
    phase[k] = Math.floor(random(seed, salt, k, 0, 1) * period[k]);
  }
  const wet = (timeMs: number, visit: (x: number, y: number, colour: number) => void) => {
    const s = step(timeMs, WEATHER_FPS);
    for (let k = 0; k < count; k++) {
      const u = s + phase[k];
      const gen = Math.floor(u / period[k]);
      const local = u - gen * period[k];
      let x = region.x + Math.floor(random(seed, salt, k, gen, 2) * region.w);
      const y0 = region.y + Math.floor(random(seed, salt, k, gen, 3) * region.h);
      const size = random(seed, salt, k, gen, 4) < TRICKLE_TALL ? 2 : 1;
      const drop = bottom + size - 1 - y0;
      const hops = Math.ceil(drop / TRICKLE_SLIDE_PX);
      const every = quickest + Math.floor(random(seed, salt, k, gen, 5) * (slowest - quickest + 1));
      const hold = period[k] - hops * every - TRICKLE_TRAIL_STEPS;
      let fallen = 0;
      for (let i = 0; i < hops && local > hold; i++) {
        const d = 8 + i * 4;
        const aim = Math.round((drop * (i + 1)) / hops + 2 * random(seed, salt, k, gen, d) - 1);
        const reach = i === hops - 1 ? drop : Math.min(drop - (hops - 1 - i), Math.max(fallen + 1, aim));
        const length = reach - fallen;
        const start = hold + i * every + Math.floor(random(seed, salt, k, gen, d + 1) * Math.max(0, every - length));
        if (start >= local) break;
        const jog = random(seed, salt, k, gen, d + 2);
        const push = jog < Math.abs(wind) ? Math.sign(wind) : jog < Math.abs(wind) + TRICKLE_JOG ? (random(seed, salt, k, gen, d + 3) < 0.5 ? -1 : 1) : 0;
        const dx = x + push >= region.x && x + push < region.x + region.w ? push : 0;
        const jogAt = Math.ceil(length / 2);
        for (let m = 0; m < length; m++) {
          const age = local - (start + m + 1);
          if (age < 0 || age >= TRICKLE_TRAIL_STEPS || age >= s) continue;
          if (age >= TRICKLE_TRAIL_STEPS * TRICKLE_BEADING && (fallen + m) % 2 === 1) continue;
          visit(m >= jogAt ? x + dx : x, y0 + fallen + m, trail[trail.length - 1 - Math.floor((age * trail.length) / TRICKLE_TRAIL_STEPS)]);
        }
        const moved = Math.min(length, local - start);
        if (moved >= jogAt) x += dx;
        fallen += moved;
        if (moved < length) break;
      }
      const formed = Math.min(local, s);
      const level = Math.floor((formed * (trail.length + 1)) / TRICKLE_FORM_STEPS) - 1;
      if (level < 0) continue;
      const colour = level >= trail.length ? bead : trail[level];
      for (let j = 0; j < size; j++) visit(x, y0 + fallen - j, colour);
    }
  };
  return {
    after: p.anchor ? ctx.anchor(p.anchor).layer : ctx.top,
    fps: WEATHER_FPS,
    state(timeMs) {
      let h = 0;
      wet(timeMs, (x, y, colour) => {
        if (x >= region.x && x < region.x + region.w && y >= region.y && y < bottom) h = mix(h ^ ((x + 64) | ((y + 64) << 10) | (colour << 20)));
      });
      return h;
    },
    draw(out, timeMs) {
      wet(timeMs, (x, y, colour) => plotIn(out, c, region, x, y, colour));
    },
  };
}

const FLASH_FIRST_PULSE_STEPS = [2, 3] as const;
const FLASH_PULSE_STEPS = [1, 3] as const;
const FLASH_GAP_STEPS = [1, 3] as const;
const FLASH_MOST_PULSES = 3;
const FLASH_LONGEST_STEPS = FLASH_MOST_PULSES * FLASH_PULSE_STEPS[1] + (FLASH_MOST_PULSES - 1) * FLASH_GAP_STEPS[1];

// Flash j starts in the jth slot of the mean gap, pushed later by less than a slot, so starts stay in order and an older flash never outlasts a newer one.
function flashStartStep(seed: number, salt: number, [min, max]: readonly [number, number], j: number): number {
  const slotSteps = ((min + max) / 2) * WEATHER_FPS;
  const jitterSteps = ((max - min) / 2) * WEATHER_FPS;
  return Math.floor(min * WEATHER_FPS + j * slotSteps + random(seed, salt, j, 0, 0) * jitterSteps);
}

export function* flashTimes(seed: number, salt: number, every: readonly [number, number]): Generator<number, never> {
  for (let j = 0; ; j++) yield flashStartStep(seed, salt, every, j) / WEATHER_FPS;
}

function flash(p: Of<"flash">, ctx: Context): PrimitiveDraw {
  const { seed, salt, colours: c, ramps } = ctx;
  if (!ramps) throw new Error(`Primitive ${salt} (flash): the Palette has no Ramp table to lift pixels along`);
  const { placement, pixels, layer } = ctx.anchor(p.anchor);
  const { region, steps } = p;
  const at: number[] = [], froms: number[] = [], intos: number[] = [];
  eachPlacedPixel(placement, pixels, (pixel, source) => {
    const x = pixel % SCENE_WIDTH, y = Math.floor(pixel / SCENE_WIDTH);
    if (x < region.x || x >= region.x + region.w || y < region.y || y >= region.y + region.h) return;
    const index = sourceIndex(c, pixels, source);
    if (index === undefined) return;
    if (ramps[index].cool === index) return;
    at.push(pixel);
    froms.push(index);
    for (let lift = 0, into = index; lift < steps; lift++) intos.push((into = ramps[into].cool));
  });
  const positions = Int32Array.from(at), from = Uint8Array.from(froms), into = Uint8Array.from(intos);
  const [min, max] = p.every;
  const firstSteps = min * WEATHER_FPS;
  const slotSteps = ((min + max) / 2) * WEATHER_FPS;
  // The first pulse lifts the full steps; a later one may fall a step short, so the flicker dims as it dies.
  const flickerAt = (j: number, local: number) => {
    const pulses = random(seed, salt, j, 0, 1) < 0.4 ? FLASH_MOST_PULSES : FLASH_MOST_PULSES - 1;
    let t = 0;
    for (let k = 0; k < pulses; k++) {
      const [shortest, longest] = k === 0 ? FLASH_FIRST_PULSE_STEPS : FLASH_PULSE_STEPS;
      t += shortest + Math.floor(random(seed, salt, j, k, 2) * (longest - shortest + 1));
      if (local < t) return k === 0 ? steps : Math.max(1, steps - Math.floor(random(seed, salt, j, k, 4) * 2));
      t += FLASH_GAP_STEPS[0] + Math.floor(random(seed, salt, j, k, 3) * (FLASH_GAP_STEPS[1] - FLASH_GAP_STEPS[0] + 1));
      if (local < t) return 0;
    }
    return 0;
  };
  const lit = (timeMs: number) => {
    if (positions.length === 0) return 0;
    const s = step(timeMs, WEATHER_FPS);
    for (let j = Math.floor((s - firstSteps) / slotSteps); j >= 0; j--) {
      const local = s - flashStartStep(seed, salt, p.every, j);
      if (local < 0) continue;
      if (local >= FLASH_LONGEST_STEPS) return 0;
      const lift = flickerAt(j, local);
      if (lift) return lift;
    }
    return 0;
  };
  return {
    after: layer,
    fps: WEATHER_FPS,
    state: lit,
    draw(out, timeMs) {
      const lift = lit(timeMs);
      if (!lift) return;
      for (let k = 0; k < positions.length; k++) if (isColour(out, c, positions[k], from[k])) paint(out, c, positions[k], into[k * steps + lift - 1]);
    },
  };
}

const GARLAND_DIM_STEPS = 8;
const GARLAND_SAMPLES_PER_PX = 4;
// Each pixel is [dx, dy, shade]: 0 takes the highlight, 1 the bauble's colour, 2 its Ramp's dark step for a rounded edge.
const BAUBLE_SHAPES: Record<number, readonly (readonly [number, number, number])[]> = {
  2: [[0, 0, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]],
  3: [[0, 0, 2], [1, 0, 1], [2, 0, 2], [0, 1, 1], [1, 1, 0], [2, 1, 1], [0, 2, 2], [1, 2, 1], [2, 2, 2]],
};

function garland(p: Of<"garland">, ctx: Context): PrimitiveDraw {
  const { seed, salt, colours: c, ramps } = ctx;
  const { layer } = ctx.anchor(p.anchor);
  const { region, sag, spacing, rate } = p;
  const bulbColours = p.colours ?? [];
  const x0 = Math.max(region.x, 0), y0 = Math.max(region.y, 0);
  const x1 = Math.min(region.x + region.w, SCENE_WIDTH), y1 = Math.min(region.y + region.h, SCENE_HEIGHT);
  const pixelAt = (x: number, y: number) => (x < x0 || x >= x1 || y < y0 || y >= y1 ? -1 : y * SCENE_WIDTH + x);
  const wire = new Set<number>();
  const bulbAt = new Map<number, number>();
  let n = 0;
  for (const strand of p.strands) {
    let walked = 0, next = 0, px = strand[0].x, py = strand[0].y;
    for (let j = 1; j < strand.length; j++) {
      const a = strand[j - 1], b = strand[j];
      const samples = Math.max(1, Math.ceil((Math.hypot(b.x - a.x, b.y - a.y) + 2 * sag) * GARLAND_SAMPLES_PER_PX));
      for (let i = j === 1 ? 0 : 1; i <= samples; i++) {
        const t = i / samples;
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t + sag * 4 * t * (1 - t);
        walked += Math.hypot(x - px, y - py);
        px = x;
        py = y;
        const pixel = pixelAt(Math.round(x), Math.round(y));
        if (pixel >= 0) wire.add(pixel);
        if (walked < next - 1e-9) continue;
        if (pixel >= 0) bulbAt.set(pixel, bulbColours[n % bulbColours.length]);
        n++;
        next += spacing;
      }
    }
  }
  const bulbs = Int32Array.from(bulbAt.keys()), on = Uint8Array.from(bulbAt.values());
  const dim = Int16Array.from(on, (colour) => (ramps ? ramps[colour].dark : -1));
  const dimmable = Uint8Array.from(on, (colour, k) => Number(dim[k] !== colour));
  const shape = BAUBLE_SHAPES[p.baubleSize];
  const baubles: [number, number][] = [];
  for (const b of p.baubles) {
    for (const [dx, dy, shade] of shape) {
      const pixel = pixelAt(b.x + dx, b.y + dy);
      const colour = shade === 0 && p.highlight !== undefined ? p.highlight : shade === 2 ? (ramps ? ramps[b.colour].dark : -1) : b.colour;
      if (pixel >= 0 && colour >= 0) baubles.push([pixel, colour]);
    }
  }
  const count = bulbs.length;
  const dimmers = dimmable.reduce((sum, d) => sum + d, 0);
  const chance = Math.min(1, (rate * GARLAND_DIM_STEPS) / PROP_FPS);
  const phase = new Uint32Array(count);
  for (let k = 0; k < count; k++) phase[k] = Math.floor(random(seed, salt, k, 0, 0) * GARLAND_DIM_STEPS);
  const dimmed = new Uint8Array(count);
  const dimAll = (timeMs: number) => {
    const s = step(timeMs, PROP_FPS);
    let total = 0, first = -1;
    for (let k = 0; k < count; k++) {
      dimmed[k] = dimmable[k] && random(seed, salt, k, Math.floor((s + phase[k]) / GARLAND_DIM_STEPS), 1) < chance ? 1 : 0;
      total += dimmed[k];
      if (dimmed[k] && first < 0) first = k;
    }
    if (dimmers > 1 && total === dimmers) dimmed[first] = 0;
  };
  const drawsNothing = count === 0 && (p.wire === undefined || wire.size === 0) && baubles.length === 0;
  return {
    after: layer,
    fps: PROP_FPS,
    state(timeMs) {
      if (drawsNothing) return 0;
      dimAll(timeMs);
      let h = 0x2545f491, l = 0x6a09e667;
      for (let k = 0; k < count; k++) {
        if (!dimmed[k]) continue;
        h = mix(h ^ k);
        l = mix(l ^ Math.imul(k, 0x9e3779b1));
      }
      return (h & 0xfffff) * 4294967296 + l + 1;
    },
    draw(out, timeMs) {
      if (p.wire !== undefined) for (const pixel of wire) paint(out, c, pixel, p.wire);
      for (const [pixel, colour] of baubles) paint(out, c, pixel, colour);
      dimAll(timeMs);
      for (let k = 0; k < count; k++) {
        const colour = dimmed[k] ? dim[k] : on[k];
        if (colour >= 0) paint(out, c, bulbs[k], colour);
      }
    },
  };
}

export function createPrimitives({ plan, elements, palette, seed = plan.seed, variant = plan.variants[0], features = new Map() }: PrimitivesInput): PrimitiveDraw[] {
  const colours = coloursOf(palette);
  const placements = new Map<string, { placement: Placement; layer: number }>();
  plan.layers.forEach((layer, li) => placementsOf(layer).forEach((placement) => placements.set(placement.id, { placement, layer: li })));
  return activePrimitives(plan, variant).map((raw, salt) => {
    const primitive = primitiveSchema.parse(raw);
    const ctx: Context = {
      seed,
      salt,
      colours,
      ramps: palette.ramps,
      top: plan.layers.length - 1,
      anchor(id) {
        const found = placements.get(id);
        if (!found) throw new Error(`Primitive ${salt} (${primitive.type}): no Placement ${id} to anchor to`);
        const pixels = elements.get(found.placement.element);
        if (!pixels) throw new Error(`Primitive ${salt} (${primitive.type}): Element ${found.placement.element} has no pixels`);
        const placement = positioned(found.placement, pixels.still, plan.stage);
        return { layer: found.layer, placement, pixels: features.get(id) ?? pixels.still };
      },
    };
    return { ...drawOf(primitive, ctx), emissive: primitive.emissive };
  });
}

function drawOf(primitive: Primitive, ctx: Context): PrimitiveDraw {
  switch (primitive.type) {
    case "rain": return rain(primitive, ctx);
    case "snow": return snow(primitive, ctx);
    case "steam": return steam(primitive, ctx);
    case "twinkle": return twinkle(primitive, ctx);
    case "blink": return blink(primitive, ctx);
    case "dust": return dust(primitive, ctx);
    case "sway": return sway(primitive, ctx);
    case "birds": return birds(primitive, ctx);
    case "pendulum": return pendulum(primitive, ctx);
    case "boats": return boats(primitive, ctx);
    case "trickle": return trickle(primitive, ctx);
    case "flash": return flash(primitive, ctx);
    case "garland": return garland(primitive, ctx);
  }
}
