import { placementsOf, SCENE_HEIGHT, SCENE_WIDTH, type Palette, type Placement, type ScenePlan, type Variant } from "../schema/index.ts";
import { createRampPass, NONE, UNLIT, type Planes } from "./lighting.ts";

export type Pixels = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
export type FrameOrder = "cycle" | "pingpong" | number[];
export type FrameStrip = { image: Pixels; frames: number; fps: number; order: FrameOrder };
export type ElementPixels = { still: Pixels; strip?: FrameStrip; emissive?: readonly number[]; mask?: Pixels };

export type PrimitiveDraw = {
  after: number;
  fps: number;
  emissive?: boolean;
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
  variant?: Variant;
  companion?: Palette;
};

export type Compositor = {
  render(timeMs: number): Uint8ClampedArray;
  tick(timeMs: number): boolean;
  nextTick(timeMs: number): number;
};

type Rgba = readonly [number, number, number, number];
type Source = { pixels: Pixels; index: Uint8Array; emissive?: Uint8Array };
type Animated = { placement: Placement; layer: number; frames: Source[]; sequence: readonly number[]; fps: number; offset: number };
type Op = { overlay: Planes } | { animated: Animated } | { primitive: PrimitiveDraw; layer: number };

const PIXELS = SCENE_WIDTH * SCENE_HEIGHT;
const SIZE = PIXELS * 4;

function paletteRgba(palette: Palette): Rgba[] {
  return palette.colours.map((hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 255] as const;
  });
}

function emptyPlanes(): Planes {
  return { rgba: new Uint8ClampedArray(SIZE), index: new Uint8Array(PIXELS).fill(NONE), layer: new Uint8Array(PIXELS).fill(NONE), emissive: new Uint8Array(PIXELS) };
}

function fill(planes: Planes, colour: Rgba, index: number, layer: number): void {
  for (let i = 0; i < SIZE; i += 4) planes.rgba.set(colour, i);
  planes.index.fill(index);
  planes.layer.fill(layer);
  planes.emissive.fill(0);
}

function blit(planes: Planes, src: Source, x0: number, y0: number, flipX: boolean, layer: number): void {
  const { pixels, index, emissive } = src;
  for (let sy = 0; sy < pixels.height; sy++) {
    const y = y0 + sy;
    if (y < 0 || y >= SCENE_HEIGHT) continue;
    for (let sx = 0; sx < pixels.width; sx++) {
      const x = x0 + sx;
      if (x < 0 || x >= SCENE_WIDTH) continue;
      const k = sy * pixels.width + (flipX ? pixels.width - 1 - sx : sx);
      const s = k * 4;
      if (pixels.data[s + 3] < 128) continue;
      const p = y * SCENE_WIDTH + x;
      const d = p * 4;
      planes.rgba[d] = pixels.data[s];
      planes.rgba[d + 1] = pixels.data[s + 1];
      planes.rgba[d + 2] = pixels.data[s + 2];
      planes.rgba[d + 3] = 255;
      planes.index[p] = index[k];
      planes.layer[p] = layer;
      planes.emissive[p] = emissive ? emissive[k] : 0;
    }
  }
}

export function placedXs(p: Placement, width: number): number[] {
  if (!p.tileX) return [p.x];
  const phase = ((p.x % width) + width) % width;
  const xs: number[] = [];
  for (let x = phase === 0 ? 0 : phase - width; x < SCENE_WIDTH; x += width) xs.push(x);
  return xs;
}

function draw(planes: Planes, src: Source, p: Placement, layer: number): void {
  for (const x of placedXs(p, src.pixels.width)) blit(planes, src, x, p.y, p.flipX === true, layer);
}

function overlay(out: Planes, top: Planes): void {
  for (let p = 0; p < PIXELS; p++) {
    if (top.layer[p] === NONE) continue;
    const i = p * 4;
    out.rgba[i] = top.rgba[i];
    out.rgba[i + 1] = top.rgba[i + 1];
    out.rgba[i + 2] = top.rgba[i + 2];
    out.rgba[i + 3] = 255;
    out.index[p] = top.index[p];
    out.layer[p] = top.layer[p];
    out.emissive[p] = top.emissive[p];
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

export function mix(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// FNV-1a then the murmur3 finaliser, so near-identical ids still land on unrelated offsets.
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return mix(h);
}

function animatedOf(pixels: ElementPixels, p: Placement, seed: number, layer: number, source: (frame: Pixels) => Source): Animated | undefined {
  const { strip } = pixels;
  if (!strip || p.animation?.enabled === false) return undefined;
  const sequence = sequenceOf(p.animation?.order ?? strip.order, strip.frames);
  const offset = hash(`${seed}:${p.id}`) % sequence.length;
  return { placement: p, layer, frames: splitFrames(strip, p).map(source), sequence, fps: p.animation?.fps ?? strip.fps, offset };
}

function lookupOf(palette: Palette): Map<number, number> {
  const lookup = new Map<number, number>();
  palette.colours.forEach((hex, i) => {
    const n = parseInt(hex.slice(1), 16);
    if (!lookup.has(n)) lookup.set(n, i);
  });
  return lookup;
}

function indexOf(pixels: Pixels, lookup: Map<number, number>): Uint8Array {
  const index = new Uint8Array(pixels.width * pixels.height);
  for (let k = 0; k < index.length; k++) {
    const s = k * 4;
    index[k] = lookup.get((pixels.data[s] << 16) | (pixels.data[s + 1] << 8) | pixels.data[s + 2]) ?? NONE;
  }
  return index;
}

function emissiveOf(pixels: Pixels, index: Uint8Array, colours: readonly number[] | undefined, mask: Pixels | undefined): Uint8Array | undefined {
  if (!colours?.length) return undefined;
  const lit = new Set(colours);
  const masked = mask && mask.width === pixels.width && mask.height === pixels.height ? mask : undefined;
  const emissive = new Uint8Array(index.length);
  for (let k = 0; k < index.length; k++) {
    if (!lit.has(index[k])) continue;
    if (masked && (masked.data[k * 4 + 3] < 128 || masked.data[k * 4] < 128)) continue;
    emissive[k] = 1;
  }
  return emissive;
}

export const step = (timeMs: number, fps: number) => Math.floor((timeMs * fps) / 1000);

export function createCompositor({ plan, elements, palette, seed = plan.seed, primitives = [], variant = plan.variants[0], companion }: CompositorInput): Compositor {
  const colours = paletteRgba(palette);
  const lookup = lookupOf(palette);
  const switchedOff = new Set(variant.emissiveOff);
  const indexed = new Map<Pixels, Uint8Array>();
  const sourceOf = (pixels: ElementPixels, frame: Pixels, p: Placement): Source => {
    let index = indexed.get(frame);
    if (!index) indexed.set(frame, (index = indexOf(frame, lookup)));
    const emissive = switchedOff.has(p.id) ? undefined : emissiveOf(frame, index, pixels.emissive, pixels.mask);
    return { pixels: frame, index, emissive };
  };

  let ops: Op[] = [];
  let current = emptyPlanes();
  let drawn = true;
  fill(current, colours[0], 0, UNLIT);

  const push = (op: Op) => {
    if (drawn) ops.push({ overlay: current });
    ops.push(op);
    current = emptyPlanes();
    drawn = false;
  };

  plan.layers.forEach((layer, li) => {
    if (layer.kind === "fill") {
      ops = [];
      fill(current, colours[layer.colour], layer.colour, li);
      drawn = true;
    }
    for (const p of placementsOf(layer)) {
      const pixels = elements.get(p.element);
      if (!pixels) throw new Error(`Placement ${p.id}: Element ${p.element} has no pixels`);
      const animated = animatedOf(pixels, p, seed, li, (frame) => sourceOf(pixels, frame, p));
      if (animated) push({ animated });
      else {
        draw(current, sourceOf(pixels, pixels.still, p), p, li);
        drawn = true;
      }
    }
    for (const primitive of primitives) if (primitive.after === li) push({ primitive, layer: li });
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
  const frame = emptyPlanes();
  const words = new Uint32Array(frame.rgba.buffer);
  const before = new Uint32Array(PIXELS);
  const light = createRampPass({ plan, palette, variant, companion });
  const out = new Uint8ClampedArray(SIZE);

  // Primitives paint RGBA only, so the pixels one changed are read back to Palette indices.
  const drawPrimitive = (primitive: PrimitiveDraw, layer: number, timeMs: number) => {
    before.set(words);
    primitive.draw(frame.rgba, timeMs);
    const emissive = primitive.emissive ? 1 : 0;
    for (let p = 0; p < PIXELS; p++) {
      if (words[p] === before[p]) continue;
      const i = p * 4;
      frame.index[p] = lookup.get((frame.rgba[i] << 16) | (frame.rgba[i + 1] << 8) | frame.rgba[i + 2]) ?? NONE;
      frame.layer[p] = layer;
      frame.emissive[p] = emissive;
    }
  };

  return {
    render(timeMs) {
      for (const op of ops) {
        if ("overlay" in op) overlay(frame, op.overlay);
        else if ("primitive" in op) drawPrimitive(op.primitive, op.layer, timeMs);
        else {
          const a = op.animated;
          const f = a.sequence[(a.offset + step(timeMs, a.fps)) % a.sequence.length];
          draw(frame, a.frames[f], a.placement, a.layer);
        }
      }
      light(frame, out);
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
