import { createFlicker, flickerTick, type Flicker } from "./flicker.ts";
import { allPlacements, PLANE_RAMP_OFFSETS, SCENE_HEIGHT, SCENE_WIDTH, type Light, type Palette, type ScenePlan, type Variant } from "../schema/index.ts";

const MIN_LEVEL = -4;
const MAX_LEVEL = 3;
export const NONE = 255;
export const UNLIT = 254;

const LEVELS = MAX_LEVEL - MIN_LEVEL + 1;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const WARM = 0;
const COOL = 1;
const PIXELS = SCENE_WIDTH * SCENE_HEIGHT;

export type Planes = { rgba: Uint8ClampedArray; index: Uint8Array; layer: Uint8Array; emissive: Uint8Array };

export type LightingInput = { plan: ScenePlan; palette: Palette; variant: Variant; seed: number; companion?: Palette };

// Browsers and Node run little-endian, so a pixel's RGBA bytes read as one ABGR word.
function words(palette: Palette): Uint32Array {
  const out = new Uint32Array(palette.colours.length);
  palette.colours.forEach((hex, i) => {
    const n = parseInt(hex.slice(1), 16);
    out[i] = (0xff << 24) | ((n & 255) << 16) | (n & 0xff00) | (n >> 16);
  });
  return out;
}

function rampTable(palette: Palette): Uint8Array {
  const { ramps } = palette;
  if (!ramps) throw new Error(`Palette ${palette.name} has no Ramp table`);
  const k = palette.colours.length;
  const lut = new Uint8Array(2 * k * LEVELS);
  for (const tint of [WARM, COOL]) {
    for (let c = 0; c < k; c++) {
      for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
        let at = c;
        for (let s = 0; s < Math.abs(level); s++) at = level < 0 ? ramps[at].dark : tint === WARM ? ramps[at].warm : ramps[at].cool;
        lut[(tint * k + c) * LEVELS + level - MIN_LEVEL] = at;
      }
    }
  }
  return lut;
}

export type LightField = { level: Float32Array; tint: Uint8Array };

type Point = Extract<Light, { type: "point" }>;
type Source = { tint: number; flicker?: Flicker; at(x: number, y: number): number };

function pointOf(light: Point, plan: ScenePlan): { x: number; y: number } {
  if (light.at) return light.at;
  const anchor = allPlacements(plan).find((p) => p.id === light.anchor);
  if (!anchor) throw new Error(`Light ${light.id}: no Placement ${light.anchor} to anchor to`);
  return { x: anchor.x + (light.offset?.x ?? 0), y: anchor.y + (light.offset?.y ?? 0) };
}

function pointContribution(light: Point, plan: ScenePlan): (x: number, y: number) => number {
  const { x: lx, y: ly } = pointOf(light, plan);
  const r2 = light.radius * light.radius;
  return (x, y) => {
    const d2 = (x - lx) ** 2 + (y - ly) ** 2;
    return d2 >= r2 ? 0 : light.strength * (1 - Math.sqrt(d2 / r2));
  };
}

function beamContribution(light: Extract<Light, { type: "beam" }>): (x: number, y: number) => number {
  const c = light.corners;
  const area = c.reduce((sum, a, i) => sum + a.x * c[(i + 1) % 4].y - c[(i + 1) % 4].x * a.y, 0);
  const sign = Math.sign(area);
  const edges = c.map((a, i) => {
    const b = c[(i + 1) % 4];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return { a, dx: (b.x - a.x) / length, dy: (b.y - a.y) / length };
  });
  return (x, y) => {
    let inside = Infinity;
    for (const { a, dx, dy } of edges) {
      const d = sign * (dx * (y - a.y) - dy * (x - a.x));
      if (d < 0) return 0;
      if (d < inside) inside = d;
    }
    return light.softness > 0 ? light.strength * Math.min(1, inside / light.softness) : light.strength;
  };
}

// A dipped Light gives up one whole step, never more than it gave, so its edge falls to unlit and not below.
function lightField(sources: readonly Source[], dipped: number): LightField {
  const level = new Float32Array(PIXELS);
  const tint = new Uint8Array(PIXELS);
  for (let y = 0; y < SCENE_HEIGHT; y++) {
    for (let x = 0; x < SCENE_WIDTH; x++) {
      const i = y * SCENE_WIDTH + x;
      let sum = 0;
      let strongest = 0;
      for (let k = 0; k < sources.length; k++) {
        let v = sources[k].at(x, y);
        if (dipped & (1 << k)) v = v > 1 ? v - 1 : 0;
        sum += v;
        if (v > strongest) {
          strongest = v;
          tint[i] = sources[k].tint;
        }
      }
      level[i] = sum;
    }
  }
  return { level, tint };
}

type Halo = { x: number; y: number; radius: number; strength: number; rgb: readonly [number, number, number]; flicker?: Flicker };

function halosOf(plan: ScenePlan, lights: readonly Light[], shown: Palette, sources: readonly Source[]): Halo[] {
  return lights.flatMap((light, i): Halo[] => {
    if (light.type !== "point" || !light.halo) return [];
    const n = parseInt(shown.colours[light.halo.colour].slice(1), 16);
    const { x, y } = pointOf(light, plan);
    return [{ x, y, radius: light.halo.radius, strength: light.halo.strength, rgb: [n >> 16, (n >> 8) & 255, n & 255], flicker: sources[i].flicker }];
  });
}

function drawHalo(out: Uint8ClampedArray, halo: Halo, brightness: number): void {
  const { x: hx, y: hy, radius, rgb } = halo;
  const peak = halo.strength * brightness;
  const x0 = Math.max(0, Math.ceil(hx - radius));
  const x1 = Math.min(SCENE_WIDTH - 1, Math.floor(hx + radius));
  const y0 = Math.max(0, Math.ceil(hy - radius));
  const y1 = Math.min(SCENE_HEIGHT - 1, Math.floor(hy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - hx, y - hy);
      if (d >= radius) continue;
      const a = peak * (1 - d / radius);
      const o = (y * SCENE_WIDTH + x) * 4;
      out[o] += rgb[0] * a;
      out[o + 1] += rgb[1] * a;
      out[o + 2] += rgb[2] * a;
    }
  }
}

export type Lighting = {
  flickers: boolean;
  state(timeMs: number): number;
  field(timeMs: number): LightField;
  apply(planes: Planes, out: Uint8ClampedArray, timeMs: number): void;
};

export function createLighting({ plan, palette, variant, seed, companion }: LightingInput): Lighting {
  const shown = companion ?? palette;
  if (shown.colours.length !== palette.colours.length) {
    throw new Error(`companion Palette ${shown.name} has ${shown.colours.length} colours, ${palette.name} has ${palette.colours.length}`);
  }
  const colours = words(shown);
  const lut = rampTable(shown);
  const k = shown.colours.length;
  const base = plan.layers.map((l) => variant.ambient.level + (variant.ambient.layers?.[l.name] ?? PLANE_RAMP_OFFSETS[l.plane]));
  const sources: Source[] = variant.lights.map((light) => {
    return {
      tint: light.tint === "cool" ? COOL : WARM,
      flicker: light.type === "point" && light.flicker ? createFlicker(light.flicker, seed, light.id) : undefined,
      at: light.type === "point" ? pointContribution(light, plan) : beamContribution(light),
    };
  });
  const flickers = sources.some((s) => s.flicker);
  const halos = halosOf(plan, variant.lights, shown, sources);
  const haloFlickers = halos.some((h) => h.flicker);
  const fields = new Map<number, LightField>();
  const dippedAt = (tick: number) => sources.reduce((mask, s, i) => (s.flicker?.dips(tick) ? mask | (1 << i) : mask), 0);
  const field = (timeMs: number) => {
    const dipped = flickers ? dippedAt(flickerTick(timeMs)) : 0;
    let cached = fields.get(dipped);
    if (!cached) fields.set(dipped, (cached = lightField(sources, dipped)));
    return cached;
  };

  return {
    flickers,
    state: (timeMs) => (haloFlickers ? flickerTick(timeMs) : flickers ? dippedAt(flickerTick(timeMs)) : 0),
    field,
    apply({ rgba, index, layer, emissive }, out, timeMs) {
      const { level: lit, tint } = field(timeMs);
      const src = new Uint32Array(rgba.buffer, rgba.byteOffset, PIXELS);
      const dst = new Uint32Array(out.buffer, out.byteOffset, PIXELS);
      for (let y = 0; y < SCENE_HEIGHT; y++) {
        for (let x = 0; x < SCENE_WIDTH; x++) {
          const i = y * SCENE_WIDTH + x;
          const c = index[i];
          if (c === NONE) {
            dst[i] = src[i];
            continue;
          }
          const l = layer[i];
          if (l >= UNLIT || emissive[i]) {
            dst[i] = colours[c];
            continue;
          }
          const f = base[l] + lit[i];
          let level = plan.dither ? Math.floor(f + BAYER[((y & 3) << 2) | (x & 3)]) : Math.round(f);
          level = level < MIN_LEVEL ? MIN_LEVEL : level > MAX_LEVEL ? MAX_LEVEL : level;
          dst[i] = colours[lut[(tint[i] * k + c) * LEVELS + level - MIN_LEVEL]];
        }
      }
      const tick = flickerTick(timeMs);
      for (const halo of halos) drawHalo(out, halo, halo.flicker ? halo.flicker.brightness(tick) : 1);
    },
  };
}
