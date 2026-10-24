import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { allPlacements, elementRecordSchema, paletteSchema, type Palette, type ScenePlan } from "../../schema/index.ts";
import { elementPixelsOf, type ElementPixels, type Pixels } from "../../viewer/compositor.ts";

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

export async function loadElementPixels(root: string, plan: ScenePlan): Promise<Map<string, ElementPixels>> {
  const ids = new Set(allPlacements(plan).map((p) => p.element));
  const loaded = new Map<string, ElementPixels>();
  for (const id of ids) {
    const record = elementRecordSchema.parse(readJson(join(root, ELEMENTS, `${id}.json`)));
    loaded.set(id, await elementPixelsOf(record, (suffix) => decode(join(root, ELEMENTS, `${id}${suffix}`))));
  }
  return loaded;
}
