import type { Pixels } from "../pixel-ops.ts";

export type Rgb = readonly [number, number, number];

export class Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  set(x: number, y: number, rgb: Rgb): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data.set([rgb[0], rgb[1], rgb[2], 255], (y * this.width + x) * 4);
  }

  rect(x: number, y: number, w: number, h: number, rgb: Rgb): void {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) this.set(col, row, rgb);
  }

  border(x: number, y: number, w: number, h: number, thickness: number, rgb: Rgb): void {
    this.rect(x, y, w, thickness, rgb);
    this.rect(x, y + h - thickness, w, thickness, rgb);
    this.rect(x, y, thickness, h, rgb);
    this.rect(x + w - thickness, y, thickness, h, rgb);
  }

  pixels(): Pixels {
    return { width: this.width, height: this.height, data: this.data };
  }
}

export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

export const between = (random: () => number, min: number, max: number) => min + Math.floor(random() * (max - min + 1));
