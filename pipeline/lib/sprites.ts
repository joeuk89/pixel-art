import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { elementRecordSchema, paletteSchema, type Palette, type ScenePlan } from "../../schema/index.ts";
import type { ElementSprite, Pixels } from "../../viewer/compositor.ts";

const ELEMENTS = "library/elements";
const PALETTES = "library/palettes";

async function decode(path: string): Promise<Pixels> {
  let decoded;
  try {
    decoded = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch (e) {
    throw new Error(`cannot read ${path}: ${(e as Error).message}`);
  }
  return { width: decoded.info.width, height: decoded.info.height, data: new Uint8Array(decoded.data) };
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`cannot read ${path}: ${(e as Error).message}`);
  }
}

export function loadPalette(root: string, name: string): Palette {
  return paletteSchema.parse(readJson(join(root, PALETTES, `${name}.json`)));
}

export async function loadSprites(root: string, plan: ScenePlan): Promise<Map<string, ElementSprite>> {
  const ids = new Set(plan.layers.flatMap((layer) => (layer.placements ?? []).map((p) => p.element)));
  const sprites = new Map<string, ElementSprite>();
  for (const id of ids) {
    const record = elementRecordSchema.parse(readJson(join(root, ELEMENTS, `${id}.json`)));
    const still = await decode(join(root, ELEMENTS, `${id}.png`));
    if (record.kind === "prop" && record.animation) {
      const { frames, fps, order } = record.animation;
      const image = await decode(join(root, ELEMENTS, `${id}.strip.png`));
      sprites.set(id, { still, strip: { image, frames, fps, order } });
    } else sprites.set(id, { still });
  }
  return sprites;
}
