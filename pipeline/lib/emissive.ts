import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { decodePng } from "./element-pixels.ts";
import { rgbOf } from "./pixel-ops.ts";

type Region = { x: number; y: number; w: number; h: number };
export type EmissiveChoice = { colours: number[]; regions: Region[] };

export function parseEmissive(colours: string | undefined, regions: string[] = []): EmissiveChoice | null {
  if (colours === undefined) {
    if (regions.length > 0) throw new Error("--emissive-region needs --emissive with the colours it masks");
    return null;
  }
  const indices = colours.split(",").map((c) => {
    const n = Number(c.trim());
    if (!Number.isInteger(n) || n < 0) throw new Error(`--emissive takes Palette colour indices separated by commas, got ${colours}`);
    return n;
  });
  return {
    colours: [...new Set(indices)],
    regions: regions.map((r) => {
      const m = r.match(/^(\d+),(\d+),(\d+),(\d+)$/);
      if (!m || Number(m[3]) === 0 || Number(m[4]) === 0) throw new Error(`--emissive-region takes x,y,w,h in the Element's pixels, got ${r}`);
      return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
    }),
  };
}

export type EmissiveResult = { fields: { emissive: number[]; emissiveMask?: true }; write: (maskPath: string) => void };

// The mask covers only the emissive-coloured pixels inside the regions, so the same colour elsewhere in the Element stays lit by the Ramp pass.
export async function emissiveOf(pngPath: string, palette: readonly string[], choice: EmissiveChoice): Promise<EmissiveResult> {
  const pixels = await decodePng(pngPath);
  const keys = palette.map((hex) => rgbOf(hex).join(","));
  const index = new Int16Array(pixels.width * pixels.height).fill(-1);
  for (let k = 0; k < index.length; k++) {
    if (pixels.data[k * 4 + 3] === 0) continue;
    index[k] = keys.indexOf(`${pixels.data[k * 4]},${pixels.data[k * 4 + 1]},${pixels.data[k * 4 + 2]}`);
  }
  const used = new Set(index);
  for (const c of choice.colours) if (!used.has(c)) throw new Error(`--emissive: colour ${c} does not appear in the Element`);
  if (choice.regions.length === 0) return { fields: { emissive: choice.colours }, write: () => {} };

  for (const r of choice.regions) {
    if (r.x + r.w > pixels.width || r.y + r.h > pixels.height) throw new Error(`--emissive-region ${r.x},${r.y},${r.w},${r.h} runs outside the ${pixels.width}x${pixels.height} Element`);
  }
  const lit = new Set(choice.colours);
  const mask = new Uint8Array(pixels.width * pixels.height * 4);
  let covered = 0;
  for (const r of choice.regions) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const k = y * pixels.width + x;
      if (!lit.has(index[k]) || mask[k * 4 + 3] === 255) continue;
      mask.set([255, 255, 255, 255], k * 4);
      covered++;
    }
  }
  if (covered === 0) throw new Error("--emissive-region covers no pixel in the emissive colours");
  const png = await sharp(mask, { raw: { width: pixels.width, height: pixels.height, channels: 4 } }).png().toBuffer();
  return { fields: { emissive: choice.colours, emissiveMask: true }, write: (maskPath) => writeFileSync(maskPath, png) };
}
