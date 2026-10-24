import { primitiveSchema, SCENE_HEIGHT, SCENE_WIDTH, type Palette, type Placement, type Primitive, type ScenePlan } from "../schema/index.ts";
import type { ElementPixels, Pixels, PrimitiveDraw } from "./compositor.ts";

export const WEATHER_FPS = 24;
export const PROP_FPS = 10;

export type PrimitivesInput = { plan: ScenePlan; elements: ReadonlyMap<string, ElementPixels>; palette: Palette; seed?: number };

type Of<T extends Primitive["type"]> = Extract<Primitive, { type: T }>;
type Context = {
  seed: number;
  salt: number;
  colours: Colours;
  anchor(id: string): { placement: Placement; pixels: Pixels; layer: number };
  top: number;
};

const step = (timeMs: number, fps: number) => Math.floor((timeMs * fps) / 1000);

function mix(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// Counter-based, so any frame can be drawn from seed and time alone without replaying earlier frames.
function random(seed: number, a: number, b: number, c: number, d: number): number {
  let h = mix(seed ^ 0x9e3779b9);
  h = mix(h ^ Math.imul(a | 0, 0x27d4eb2f));
  h = mix(h ^ Math.imul(b | 0, 0x165667b1));
  h = mix(h ^ Math.imul(c | 0, 0x85ebca77));
  h = mix(h ^ Math.imul(d | 0, 0xc2b2ae3d));
  return h / 4294967296;
}

type Colours = { r: Uint8Array; g: Uint8Array; b: Uint8Array; lab: Float64Array; indexOf: Map<number, number> };

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function oklab(r: number, g: number, b: number, into: Float64Array, at: number): void {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  into[at] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  into[at + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  into[at + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

function coloursOf(palette: Palette): Colours {
  const n = palette.colours.length;
  const c: Colours = { r: new Uint8Array(n), g: new Uint8Array(n), b: new Uint8Array(n), lab: new Float64Array(n * 3), indexOf: new Map() };
  palette.colours.forEach((hex, i) => {
    const v = parseInt(hex.slice(1), 16);
    c.r[i] = v >> 16;
    c.g[i] = (v >> 8) & 255;
    c.b[i] = v & 255;
    oklab(c.r[i], c.g[i], c.b[i], c.lab, i * 3);
    if (!c.indexOf.has(v)) c.indexOf.set(v, i);
  });
  return c;
}

const probe = new Float64Array(3);
function nearest(c: Colours, r: number, g: number, b: number): number {
  oklab(r, g, b, probe, 0);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < c.r.length; i++) {
    const dl = c.lab[i * 3] - probe[0], da = c.lab[i * 3 + 1] - probe[1], db = c.lab[i * 3 + 2] - probe[2];
    const d = dl * dl + da * da + db * db;
    if (d < bestD) (bestD = d), (best = i);
  }
  return best;
}

function indexAt(c: Colours, out: Uint8ClampedArray, i: number): number {
  return c.indexOf.get((out[i] << 16) | (out[i + 1] << 8) | out[i + 2]) ?? nearest(c, out[i], out[i + 1], out[i + 2]);
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


function eachPlacedPixel(p: Placement, src: Pixels, visit: (pixel: number, source: number) => void): void {
  const starts: number[] = [];
  if (p.tileX) {
    const phase = ((p.x % src.width) + src.width) % src.width;
    for (let x = phase === 0 ? 0 : phase - src.width; x < SCENE_WIDTH; x += src.width) starts.push(x);
  } else starts.push(p.x);
  for (const x0 of starts) {
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

function rain(p: Of<"rain">, ctx: Context): PrimitiveDraw {
  const { seed, salt, colours: c } = ctx;
  const { region, colours, density, drift } = p;
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
      for (let k = 0; k < density; k++) {
        const u = s + phase[k];
        const gen = Math.floor(u / period[k]);
        const local = u - gen * period[k];
        const x = Math.round(region.x - 4 + random(seed, salt, k, gen, 3) * (region.w + 8) + local * drift);
        const y = Math.round(region.y - 3 + local * speed[k]);
        const highlight = colours.length > 1 && random(seed, salt, k, gen, 4) < 0.3;
        const colour = highlight ? colours[1 + Math.floor(random(seed, salt, k, gen, 5) * (colours.length - 1))] : colours[0];
        for (let j = 0; j < length[k]; j++) plotIn(out, c, region, x, y + j, colour);
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

const GLOW_DISCS = [[24 / 28, 0.05], [17 / 28, 0.07], [11 / 28, 0.1], [6 / 28, 0.14]] as const;
const POOL_RINGS = [[34 / 28, 6 / 28, 0.07], [24 / 28, 4 / 28, 0.09], [14 / 28, 2 / 28, 0.12]] as const;
const GLOW_LEVELS = 64;
const FLICKER_CHANCE = 0.08;
const DIM_SHARE = 0.15;
const FLICKER_SETTLE_STEPS = 12;
const FLICKER_LOOKBACK = 64;

type Rings = { dx: Int16Array; dy: Int16Array; alpha: Float64Array };

function rings(levelOf: (dx: number, dy: number) => number, alphas: readonly number[], rx: number, ry: number): Rings {
  const cumulative = [0];
  for (const a of alphas) cumulative.push(1 - (1 - cumulative[cumulative.length - 1]) * (1 - a));
  const dx: number[] = [], dy: number[] = [], alpha: number[] = [];
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    const level = levelOf(x, y);
    if (level === 0) continue;
    dx.push(x);
    dy.push(y);
    alpha.push(cumulative[level]);
  }
  return { dx: Int16Array.from(dx), dy: Int16Array.from(dy), alpha: Float64Array.from(alpha) };
}

function glow(p: Of<"glow">, ctx: Context): PrimitiveDraw {
  const { seed, salt, colours: c } = ctx;
  const { placement, layer } = ctx.anchor(p.anchor);
  const { radius, flicker, colour, pool } = p;
  const cx = placement.x + p.offset.x, cy = placement.y + p.offset.y;
  const disc = rings((x, y) => GLOW_DISCS.filter(([r]) => Math.hypot(x, y) <= r * radius).length, GLOW_DISCS.map(([, a]) => a), radius, radius);
  const poolRx = Math.ceil(POOL_RINGS[0][0] * radius), poolRy = Math.max(1, Math.ceil(POOL_RINGS[0][1] * radius));
  const poolRings = pool
    ? rings(
        (x, y) => POOL_RINGS.filter(([rx, ry]) => (x / (rx * radius)) ** 2 + (y / Math.max(1, ry * radius)) ** 2 <= 1).length,
        POOL_RINGS.map(([, , a]) => a),
        poolRx,
        poolRy,
      )
    : undefined;
  const n = c.r.length;
  const lut = new Int16Array(n * n * (GLOW_LEVELS + 1)).fill(-1);
  const slotOf = new Map<number, number>();
  const opSlot: number[] = [], opAlpha: number[] = [], opLight: number[] = [];
  const addOps = (r: Rings, x0: number, y0: number, light: number) => {
    for (let k = 0; k < r.dx.length; k++) {
      const x = x0 + r.dx[k], y = y0 + r.dy[k];
      if (x < 0 || x >= SCENE_WIDTH || y < 0 || y >= SCENE_HEIGHT) continue;
      const pixel = y * SCENE_WIDTH + x;
      if (!slotOf.has(pixel)) slotOf.set(pixel, slotOf.size);
      opSlot.push(slotOf.get(pixel)!);
      opAlpha.push(r.alpha[k]);
      opLight.push(light);
    }
  };
  addOps(disc, cx, cy, colour);
  if (pool && poolRings) addOps(poolRings, cx, pool.y, pool.colour);
  const slotPixel = Int32Array.from(slotOf.keys());
  const slots = slotPixel.length;
  const base = new Int16Array(slots).fill(-1);

  const changesAt = (j: number) => random(seed, salt, j, 0, 0) < FLICKER_CHANCE;
  const targetAt = (j: number) => {
    const dip = random(seed, salt, j, 0, 2);
    return random(seed, salt, j, 0, 1) < DIM_SHARE ? Math.max(0, 1 - flicker * (5 / 6 + (2 / 3) * dip)) : 1 - flicker * 0.5 * dip;
  };
  const level = (s: number) => {
    const from = s - FLICKER_SETTLE_STEPS;
    let target = 1;
    for (let j = from; j > from - FLICKER_LOOKBACK; j--) if (changesAt(j)) { target = targetAt(j); break; }
    let alpha = target;
    for (let j = from + 1; j <= s; j++) {
      if (changesAt(j)) target = targetAt(j);
      alpha += (target - alpha) * 0.5;
    }
    return Math.round(alpha * GLOW_LEVELS);
  };

  // Flicker levels that snap to the same Palette colours share one state, so tick skips them.
  const groups: Int16Array[] = [];
  let groupCount = 0;
  let epoch = 0;
  const groupOfLevel = new Int16Array(GLOW_LEVELS + 1).fill(-1);
  const lit = (into: Int16Array, strength: number) => {
    into.fill(-1);
    for (let k = 0; k < opSlot.length; k++) {
      const q = Math.round(opAlpha[k] * strength * GLOW_LEVELS);
      if (q === 0) continue;
      const slot = opSlot[k];
      const under = into[slot] >= 0 ? into[slot] : base[slot];
      const key = (under * n + opLight[k]) * (GLOW_LEVELS + 1) + q;
      if (lut[key] < 0) {
        const a = q / GLOW_LEVELS;
        lut[key] = nearest(c, Math.min(255, c.r[under] + c.r[opLight[k]] * a), Math.min(255, c.g[under] + c.g[opLight[k]] * a), Math.min(255, c.b[under] + c.b[opLight[k]] * a));
      }
      into[slot] = lut[key];
    }
  };
  const groupAt = (timeMs: number) => {
    const L = level(step(timeMs, PROP_FPS));
    if (groupOfLevel[L] >= 0) return groupOfLevel[L];
    if (groups.length === groupCount) groups.push(new Int16Array(slots));
    const fresh = groups[groupCount];
    lit(fresh, L / GLOW_LEVELS);
    let g = 0;
    while (g < groupCount && !equal(groups[g], fresh)) g++;
    if (g === groupCount) groupCount++;
    return (groupOfLevel[L] = g);
  };

  return {
    after: layer,
    fps: PROP_FPS,
    state: (timeMs) => epoch * (GLOW_LEVELS + 1) + groupAt(timeMs),
    draw(out, timeMs) {
      let moved = false;
      for (let k = 0; k < slots; k++) {
        const under = indexAt(c, out, slotPixel[k] * 4);
        if (under !== base[k]) (base[k] = under), (moved = true);
      }
      if (moved) {
        epoch++;
        groupCount = 0;
        groupOfLevel.fill(-1);
      }
      const colours = groups[groupAt(timeMs)];
      for (let k = 0; k < slots; k++) if (colours[k] >= 0) paint(out, c, slotPixel[k], colours[k]);
    },
  };
}

function equal(a: Int16Array, b: Int16Array): boolean {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
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

export function createPrimitives({ plan, elements, palette, seed = plan.seed }: PrimitivesInput): PrimitiveDraw[] {
  const colours = coloursOf(palette);
  const placements = new Map<string, { placement: Placement; layer: number }>();
  plan.layers.forEach((layer, li) => layer.placements?.forEach((placement) => placements.set(placement.id, { placement, layer: li })));
  return plan.primitives.map((raw, salt) => {
    const primitive = primitiveSchema.parse(raw);
    const ctx: Context = {
      seed,
      salt,
      colours,
      top: plan.layers.length - 1,
      anchor(id) {
        const found = placements.get(id);
        if (!found) throw new Error(`Primitive ${salt} (${primitive.type}): no Placement ${id} to anchor to`);
        const pixels = elements.get(found.placement.element);
        if (!pixels) throw new Error(`Primitive ${salt} (${primitive.type}): Element ${found.placement.element} has no pixels`);
        return { ...found, pixels: pixels.still };
      },
    };
    switch (primitive.type) {
      case "rain": return rain(primitive, ctx);
      case "snow": return snow(primitive, ctx);
      case "glow": return glow(primitive, ctx);
      case "steam": return steam(primitive, ctx);
      case "twinkle": return twinkle(primitive, ctx);
      case "blink": return blink(primitive, ctx);
    }
  });
}
