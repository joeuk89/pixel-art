import type { Canvas } from "./canvas.ts";
import {
  checkerboards, islands, offPaletteCount, opaqueBox, orphans, softAlphaCount, transparentCount, wrapSeamMismatch, type Pixels,
} from "./pixel-ops.ts";

export type { Pixels } from "./pixel-ops.ts";
export { paletteSet } from "./pixel-ops.ts";

export type Box = { width: number; height: number };
export type GateInput = { canvas: Canvas; palette: string[] } & (
  | { kind: "prop"; targetBox: Box }
  | { kind: "backdrop"; seamless?: boolean }
  | { kind: "texture" }
);
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
    orphans: number;
    orphanShare: number;
    checkerboards: number;
    wrapSeamMismatch: number;
  };
};

export const TRIM_MIN = 0.7;
export const TRIM_MAX = 1.5;
export const MAX_ISLANDS = 2;
const UPSCALE_LONG_SIDE = 1024;
const MIN_UPSCALE = 4;
const MAX_UPSCALE = 8;

export function upscaleFactor(canvas: Canvas): number {
  const fit = Math.floor(UPSCALE_LONG_SIDE / Math.max(canvas.width, canvas.height));
  return Math.min(MAX_UPSCALE, Math.max(MIN_UPSCALE, fit));
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function gateStill(pixels: Pixels, input: GateInput): GateReport {
  const { width, height } = pixels;
  const box = opaqueBox(pixels);
  const trimmed = { width: box.width, height: box.height };
  const softAlphaPixels = softAlphaCount(pixels);
  const offPalettePixels = offPaletteCount(pixels, input.palette);
  const transparentPixels = transparentCount(pixels);
  const islandCount = islands(pixels);
  const orphan = orphans(pixels);
  const seam = wrapSeamMismatch(pixels);

  const passed: string[] = [], failed: string[] = [], warnings: string[] = [];
  const check = (name: string, ok: boolean, why: string) => (ok ? passed.push(name) : failed.push(`${name}: ${why}`));
  check("dimensions", width === input.canvas.width && height === input.canvas.height,
    `${width}x${height}, derived canvas is ${input.canvas.width}x${input.canvas.height}`);
  check("alpha", softAlphaPixels === 0, `${softAlphaPixels} pixels with alpha other than 0 or 255`);
  check("palette", offPalettePixels === 0, `${offPalettePixels} opaque pixels not in the Palette`);

  if (input.kind === "prop") {
    const target = input.targetBox;
    const inBand = (got: number, want: number) => got >= TRIM_MIN * want && got <= TRIM_MAX * want;
    check("trimmed box", inBand(trimmed.width, target.width) && inBand(trimmed.height, target.height),
      `${trimmed.width}x${trimmed.height} is outside ${TRIM_MIN}x to ${TRIM_MAX}x the target box ${fmt(target.width)}x${fmt(target.height)}`);
  }
  if (input.kind === "backdrop") {
    check("opaque", transparentPixels === 0, `a Backdrop has no transparent pixels; this one has ${transparentPixels}`);
  }
  if (input.kind === "texture" || (input.kind === "backdrop" && input.seamless)) {
    check("wrap seam", seam === 0, `${seam} of ${height} rows differ between the last column and the first`);
  }
  if (islandCount > MAX_ISLANDS) warnings.push(`${islandCount} disconnected opaque islands`);

  return {
    ok: failed.length === 0,
    passed,
    failed,
    warnings,
    measurements: {
      width, height, softAlphaPixels, offPalettePixels, transparentPixels, trimmed, islands: islandCount,
      orphans: orphan.count, orphanShare: orphan.share, checkerboards: checkerboards(pixels), wrapSeamMismatch: seam,
    },
  };
}
