import { SCENE_HEIGHT, SCENE_WIDTH, type Palette, type Placement, type ScenePlan } from "../schema/index.ts";

export type Pixels = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
export type FrameOrder = "cycle" | "pingpong" | number[];
export type FrameStrip = { image: Pixels; frames: number; fps: number; order: FrameOrder };
export type ElementPixels = { still: Pixels; strip?: FrameStrip };

export type PrimitiveDraw = {
  after: number;
  fps: number;
  draw(out: Uint8ClampedArray, timeMs: number): void;
  // Equal states at two times promise identical pixels, so tick can skip a step that changes nothing.
  state?(timeMs: number): number;
};

export type CompositorInput = {
  plan: ScenePlan;
  elements: ReadonlyMap<string, ElementPixels>;
  palette: Palette;
  seed?: number;
  primitives?: readonly PrimitiveDraw[];
};

export type Compositor = {
  render(timeMs: number): Uint8ClampedArray;
  tick(timeMs: number): boolean;
  nextTick(timeMs: number): number;
};

type Rgba = readonly [number, number, number, number];
type Animated = { placement: Placement; frames: Pixels[]; sequence: readonly number[]; fps: number; offset: number };
type Op = { overlay: Uint8ClampedArray } | { animated: Animated } | { primitive: PrimitiveDraw };

const SIZE = SCENE_WIDTH * SCENE_HEIGHT * 4;

function paletteRgba(palette: Palette): Rgba[] {
  return palette.colours.map((hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 255] as const;
  });
}

function fill(out: Uint8ClampedArray, colour: Rgba): void {
  for (let i = 0; i < out.length; i += 4) out.set(colour, i);
}

function blit(out: Uint8ClampedArray, src: Pixels, x0: number, y0: number, flipX: boolean): void {
  for (let sy = 0; sy < src.height; sy++) {
    const y = y0 + sy;
    if (y < 0 || y >= SCENE_HEIGHT) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const x = x0 + sx;
      if (x < 0 || x >= SCENE_WIDTH) continue;
      const s = (sy * src.width + (flipX ? src.width - 1 - sx : sx)) * 4;
      if (src.data[s + 3] < 128) continue;
      const d = (y * SCENE_WIDTH + x) * 4;
      out[d] = src.data[s];
      out[d + 1] = src.data[s + 1];
      out[d + 2] = src.data[s + 2];
      out[d + 3] = 255;
    }
  }
}

function draw(out: Uint8ClampedArray, src: Pixels, p: Placement): void {
  const flipX = p.flipX === true;
  if (!p.tileX) return blit(out, src, p.x, p.y, flipX);
  const phase = ((p.x % src.width) + src.width) % src.width;
  const first = phase === 0 ? 0 : phase - src.width;
  for (let x = first; x < SCENE_WIDTH; x += src.width) blit(out, src, x, p.y, flipX);
}

function overlay(out: Uint8ClampedArray, layer: Uint8ClampedArray): void {
  for (let i = 0; i < SIZE; i += 4) {
    if (layer[i + 3] === 0) continue;
    out[i] = layer[i];
    out[i + 1] = layer[i + 1];
    out[i + 2] = layer[i + 2];
    out[i + 3] = 255;
  }
}

function sequenceOf(order: FrameOrder, frames: number): number[] {
  if (Array.isArray(order)) return order;
  const forward = Array.from({ length: frames }, (_, i) => i);
  return order === "cycle" ? forward : [...forward, ...forward.slice(1, -1).reverse()];
}

function splitFrames(strip: FrameStrip, placement: Placement): Pixels[] {
  const width = strip.image.width / strip.frames;
  if (!Number.isInteger(width)) throw new Error(`Placement ${placement.id}: strip width ${strip.image.width} is not ${strip.frames} frames`);
  const { height } = strip.image;
  return Array.from({ length: strip.frames }, (_, f) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const start = (y * strip.image.width + f * width) * 4;
      data.set(strip.image.data.subarray(start, start + width * 4), y * width * 4);
    }
    return { width, height, data };
  });
}

// FNV-1a then the murmur3 finaliser, so near-identical ids still land on unrelated offsets.
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function animatedOf(pixels: ElementPixels, p: Placement, seed: number): Animated | undefined {
  const { strip } = pixels;
  if (!strip || p.animation?.enabled === false) return undefined;
  const sequence = sequenceOf(p.animation?.order ?? strip.order, strip.frames);
  const offset = hash(`${seed}:${p.id}`) % sequence.length;
  return { placement: p, frames: splitFrames(strip, p), sequence, fps: p.animation?.fps ?? strip.fps, offset };
}

const step = (timeMs: number, fps: number) => Math.floor((timeMs * fps) / 1000);

export function createCompositor({ plan, elements, palette, seed = plan.seed, primitives = [] }: CompositorInput): Compositor {
  const colours = paletteRgba(palette);
  let ops: Op[] = [];
  let current = new Uint8ClampedArray(SIZE);
  let drawn = true;
  fill(current, colours[0]);

  const push = (op: Op) => {
    if (drawn) ops.push({ overlay: current });
    ops.push(op);
    current = new Uint8ClampedArray(SIZE);
    drawn = false;
  };

  plan.layers.forEach((layer, li) => {
    if (layer.fill !== undefined) {
      ops = [];
      fill(current, colours[layer.fill]);
      drawn = true;
    }
    for (const p of layer.placements ?? []) {
      const pixels = elements.get(p.element);
      if (!pixels) throw new Error(`Placement ${p.id}: Element ${p.element} has no pixels`);
      const animated = animatedOf(pixels, p, seed);
      if (animated) push({ animated });
      else {
        draw(current, pixels.still, p);
        drawn = true;
      }
    }
    for (const primitive of primitives) if (primitive.after === li) push({ primitive });
  });
  if (drawn) ops.push({ overlay: current });

  type Clock = { fps: number; state(timeMs: number): number };
  const clocks: Clock[] = ops.flatMap((op): Clock[] => {
    if ("animated" in op) return [{ fps: op.animated.fps, state: (t) => step(t, op.animated.fps) }];
    if (!("primitive" in op)) return [];
    const { fps, state } = op.primitive;
    return [{ fps, state: state ? (t) => state(t) : (t) => step(t, fps) }];
  });
  const lastStates = clocks.map(() => -1);
  let rendered = false;
  const out = new Uint8ClampedArray(SIZE);

  return {
    render(timeMs) {
      for (const op of ops) {
        if ("overlay" in op) overlay(out, op.overlay);
        else if ("primitive" in op) op.primitive.draw(out, timeMs);
        else {
          const a = op.animated;
          const frame = a.sequence[(a.offset + step(timeMs, a.fps)) % a.sequence.length];
          draw(out, a.frames[frame], a.placement);
        }
      }
      clocks.forEach((clock, i) => (lastStates[i] = clock.state(timeMs)));
      rendered = true;
      return out;
    },
    tick(timeMs) {
      return !rendered || clocks.some((clock, i) => clock.state(timeMs) !== lastStates[i]);
    },
    nextTick(timeMs) {
      return clocks.reduce((next, { fps }) => Math.min(next, ((step(timeMs, fps) + 1) * 1000) / fps), Infinity);
    },
  };
}
