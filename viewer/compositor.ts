import { SCENE_HEIGHT, SCENE_WIDTH, type Palette, type Placement, type ScenePlan } from "../schema/index.ts";

export type Pixels = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };
export type ElementSprite = { still: Pixels };

export type CompositorInput = {
  plan: ScenePlan;
  elements: ReadonlyMap<string, ElementSprite>;
  palette: Palette;
};

export type Compositor = {
  render(timeMs: number): Uint8ClampedArray;
};

type Rgba = readonly [number, number, number, number];

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
      const a = src.data[s + 3];
      if (a === 0) continue;
      const d = (y * SCENE_WIDTH + x) * 4;
      if (a === 255) {
        out[d] = src.data[s];
        out[d + 1] = src.data[s + 1];
        out[d + 2] = src.data[s + 2];
        out[d + 3] = 255;
      } else {
        for (let c = 0; c < 3; c++) out[d + c] = Math.round((src.data[s + c] * a + out[d + c] * (255 - a)) / 255);
      }
    }
  }
}

function draw(out: Uint8ClampedArray, src: Pixels, p: Placement): void {
  if (!p.tileX) return blit(out, src, p.x, p.y, p.flipX === true);
  const phase = ((p.x % src.width) + src.width) % src.width;
  const first = phase === 0 ? 0 : phase - src.width;
  for (let x = first; x < SCENE_WIDTH; x += src.width) blit(out, src, x, p.y, p.flipX === true);
}

function sprite(elements: ReadonlyMap<string, ElementSprite>, placement: Placement): ElementSprite {
  const found = elements.get(placement.element);
  if (!found) throw new Error(`Placement ${placement.id}: Element ${placement.element} has no pixels`);
  return found;
}

export function createCompositor({ plan, elements, palette }: CompositorInput): Compositor {
  const colours = paletteRgba(palette);
  const out = new Uint8ClampedArray(SCENE_WIDTH * SCENE_HEIGHT * 4);
  fill(out, colours[0]);
  for (const layer of plan.layers) {
    if (layer.fill !== undefined) fill(out, colours[layer.fill]);
    for (const p of layer.placements ?? []) draw(out, sprite(elements, p).still, p);
  }
  return { render: () => out };
}
