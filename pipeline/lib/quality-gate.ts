import type { Canvas } from "./canvas.ts";

export type Pixels = { width: number; height: number; data: Uint8Array };
export type Box = { width: number; height: number };
export type GateInput = { canvas: Canvas; palette: string[] } & ({ kind: "prop"; targetBox: Box } | { kind: "backdrop" });
export type GateReport = {
  ok: boolean;
  passed: string[];
  failed: string[];
  warnings: string[];
  measurements: {
    width: number;
    height: number;
    softAlphaPixels: number;
    offPalettePixels: number;
    transparentPixels: number;
    trimmed: Box;
    islands: number;
  };
};

export const TRIM_MIN = 0.7;
export const TRIM_MAX = 1.5;
export const MAX_ISLANDS = 2;

export function paletteSet(palette: string[]): Set<number> {
  return new Set(palette.map((hex) => parseInt(hex.slice(1), 16)));
}

function countIslands(opaque: Uint8Array, width: number, height: number): number {
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  let islands = 0;
  for (let start = 0; start < width * height; start++) {
    if (!opaque[start] || seen[start]) continue;
    islands++;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width, y = (p - x) / width;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (opaque[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
  }
  return islands;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function gateStill(pixels: Pixels, input: GateInput): GateReport {
  const { width, height, data } = pixels;
  const colours = paletteSet(input.palette);
  const opaque = new Uint8Array(width * height);
  let softAlphaPixels = 0, offPalettePixels = 0, transparentPixels = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let p = 0; p < width * height; p++) {
    const a = data[p * 4 + 3];
    if (a !== 0 && a !== 255) softAlphaPixels++;
    if (a === 0) { transparentPixels++; continue; }
    opaque[p] = 1;
    const x = p % width, y = (p - x) / width;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    if (!colours.has((data[p * 4] << 16) | (data[p * 4 + 1] << 8) | data[p * 4 + 2])) offPalettePixels++;
  }
  const trimmed = maxX < 0 ? { width: 0, height: 0 } : { width: maxX - minX + 1, height: maxY - minY + 1 };
  const islands = countIslands(opaque, width, height);

  const passed: string[] = [], failed: string[] = [], warnings: string[] = [];
  const check = (name: string, ok: boolean, why: string) => (ok ? passed.push(name) : failed.push(`${name}: ${why}`));
  check("dimensions", width === input.canvas.width && height === input.canvas.height,
    `${width}x${height}, derived canvas is ${input.canvas.width}x${input.canvas.height}`);
  check("alpha", softAlphaPixels === 0, `${softAlphaPixels} pixels with alpha other than 0 or 255`);
  check("palette", offPalettePixels === 0, `${offPalettePixels} opaque pixels not in the Palette`);

  if (input.kind === "prop") {
    const { targetBox: box } = input;
    const inBand = (got: number, want: number) => got >= TRIM_MIN * want && got <= TRIM_MAX * want;
    if (!inBand(trimmed.width, box.width) || !inBand(trimmed.height, box.height)) {
      warnings.push(`trimmed box ${trimmed.width}x${trimmed.height} is outside ${TRIM_MIN}x to ${TRIM_MAX}x the target box ${fmt(box.width)}x${fmt(box.height)}`);
    }
  } else if (transparentPixels > 0) {
    warnings.push(`backdrop has ${transparentPixels} transparent pixels`);
  }
  if (islands > MAX_ISLANDS) warnings.push(`${islands} disconnected opaque islands`);

  return {
    ok: failed.length === 0,
    passed,
    failed,
    warnings,
    measurements: { width, height, softAlphaPixels, offPalettePixels, transparentPixels, trimmed, islands },
  };
}
