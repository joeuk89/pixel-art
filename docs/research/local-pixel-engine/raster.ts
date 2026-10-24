import { hex, type Img } from "./png.ts";

// A canvas of Palette indices: -1 is transparent. `part` records which shape owns each pixel, for internal outlines.
export class Grid {
  width: number; height: number; px: Int16Array; part: Int16Array;
  constructor(width: number, height: number) {
    this.width = width; this.height = height;
    this.px = new Int16Array(width * height).fill(-1);
    this.part = new Int16Array(width * height).fill(-1);
  }
  get(x: number, y: number) { return x < 0 || y < 0 || x >= this.width || y >= this.height ? -1 : this.px[y * this.width + x]; }
  set(x: number, y: number, c: number, part = -1) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.px[y * this.width + x] = c;
    if (part >= 0) this.part[y * this.width + x] = part;
  }
  partAt(x: number, y: number) { return x < 0 || y < 0 || x >= this.width || y >= this.height ? -1 : this.part[y * this.width + x]; }
  rect(x0: number, y0: number, w: number, h: number, c: number) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c); }
  // Fill every pixel whose centre passes `inside`, coloured by `shade`.
  fill(part: number, inside: (x: number, y: number) => boolean, shade: (x: number, y: number) => number) {
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) if (inside(x + 0.5, y + 0.5)) this.set(x, y, shade(x + 0.5, y + 0.5), part);
  }
  // Outer outline: opaque pixels touching transparency (4-neighbour) take `colour`.
  outline(colour: number) {
    const edge: number[] = [];
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      if (this.get(x, y) < 0) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.get(x + dx, y + dy) < 0)) edge.push(y * this.width + x);
    }
    for (const i of edge) this.px[i] = colour;
  }
  // Internal outline: where shape `front` meets an earlier shape, outline the front shape's boundary pixels.
  seam(front: number, colour: number, sides: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const edge: number[] = [];
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      if (this.partAt(x, y) !== front) continue;
      if (sides.some(([dx, dy]) => { const p = this.partAt(x + dx, y + dy); return p >= 0 && p !== front; })) edge.push(y * this.width + x);
    }
    for (const i of edge) this.px[i] = colour;
  }
  toImg(palette: string[]): Img {
    const data = new Uint8Array(this.width * this.height * 4);
    this.px.forEach((c, i) => { if (c >= 0) data.set([...hex(palette[c]), 255], i * 4); });
    return { width: this.width, height: this.height, data };
  }
}

export const ellipse = (cx: number, cy: number, rx: number, ry: number) => (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

// Lambert term for a point on an ellipsoid bulging toward the viewer, light from the upper left and in front.
export function lambert(cx: number, cy: number, rx: number, ry: number, light = [-0.55, -0.65, 0.52]) {
  const len = Math.hypot(...light);
  const [lx, ly, lz] = light.map((v) => v / len);
  return (x: number, y: number) => {
    const nx = (x - cx) / rx, ny = (y - cy) / ry;
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    return Math.max(0, nx * lx + ny * ly + nz * lz);
  };
}

// Pick a ramp step from a 0..1 light value with hard thresholds, so bands stay clean.
export const step = (ramp: number[], cuts: number[]) => (v: number) => ramp[cuts.filter((c) => v >= c).length];

// Deterministic noise, so a probe re-renders identically.
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
