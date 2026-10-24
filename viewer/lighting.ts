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

export type RampPassInput = { plan: ScenePlan; palette: Palette; variant: Variant; companion?: Palette };

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

type Field = { level: Float32Array; tint: Uint8Array };

function pointOf(light: Extract<Light, { type: "point" }>, plan: ScenePlan): { x: number; y: number } {
  if (light.at) return light.at;
  const anchor = allPlacements(plan).find((p) => p.id === light.anchor);
  if (!anchor) throw new Error(`Light ${light.id}: no Placement ${light.anchor} to anchor to`);
  return { x: anchor.x + (light.offset?.x ?? 0), y: anchor.y + (light.offset?.y ?? 0) };
}

function pointContribution(light: Extract<Light, { type: "point" }>, plan: ScenePlan): (x: number, y: number) => number {
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

function lightField(plan: ScenePlan, lights: readonly Light[]): Field {
  const level = new Float32Array(PIXELS);
  const tint = new Uint8Array(PIXELS);
  const sources = lights.map((light) => ({
    tint: light.tint === "cool" ? COOL : WARM,
    at: light.type === "point" ? pointContribution(light, plan) : beamContribution(light),
  }));
  for (let y = 0; y < SCENE_HEIGHT; y++) {
    for (let x = 0; x < SCENE_WIDTH; x++) {
      const i = y * SCENE_WIDTH + x;
      let sum = 0;
      let strongest = 0;
      for (const source of sources) {
        const v = source.at(x, y);
        sum += v;
        if (v > strongest) {
          strongest = v;
          tint[i] = source.tint;
        }
      }
      level[i] = sum;
    }
  }
  return { level, tint };
}

export function createRampPass({ plan, palette, variant, companion }: RampPassInput): (planes: Planes, out: Uint8ClampedArray) => void {
  const shown = companion ?? palette;
  if (shown.colours.length !== palette.colours.length) {
    throw new Error(`companion Palette ${shown.name} has ${shown.colours.length} colours, ${palette.name} has ${palette.colours.length}`);
  }
  const colours = words(shown);
  const lut = rampTable(shown);
  const k = shown.colours.length;
  const field = lightField(plan, variant.lights);
  const base = plan.layers.map((l) => variant.ambient.level + (variant.ambient.layers?.[l.name] ?? PLANE_RAMP_OFFSETS[l.plane]));

  return ({ rgba, index, layer, emissive }, out) => {
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
        const f = base[l] + field.level[i];
        let level = plan.dither ? Math.floor(f + BAYER[((y & 3) << 2) | (x & 3)]) : Math.round(f);
        level = level < MIN_LEVEL ? MIN_LEVEL : level > MAX_LEVEL ? MAX_LEVEL : level;
        dst[i] = colours[lut[(field.tint[i] * k + c) * LEVELS + level - MIN_LEVEL]];
      }
    }
  };
}
