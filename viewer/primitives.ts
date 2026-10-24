import { placementsOf, primitiveSchema, SCENE_HEIGHT, SCENE_WIDTH, type Palette, type Placement, type Primitive, type ScenePlan } from "../schema/index.ts";
import { mix, placedXs, step, type ElementPixels, type Pixels, type PrimitiveDraw } from "./compositor.ts";
import { positioned, type Positioned } from "./placement.ts";
import { random } from "./random.ts";

export const WEATHER_FPS = 24;
export const PROP_FPS = 10;

export type PrimitivesInput = { plan: ScenePlan; elements: ReadonlyMap<string, ElementPixels>; palette: Palette; seed?: number };

type Of<T extends Primitive["type"]> = Extract<Primitive, { type: T }>;
type Context = {
  seed: number;
  salt: number;
  colours: Colours;
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

export function createPrimitives({ plan, elements, palette, seed = plan.seed }: PrimitivesInput): PrimitiveDraw[] {
  const colours = coloursOf(palette);
  const placements = new Map<string, { placement: Placement; layer: number }>();
  plan.layers.forEach((layer, li) => placementsOf(layer).forEach((placement) => placements.set(placement.id, { placement, layer: li })));
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
        return { layer: found.layer, placement: positioned(found.placement, pixels.still), pixels: pixels.still };
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
  }
}
