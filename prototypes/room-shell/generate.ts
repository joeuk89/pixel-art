// PROTOTYPE. PixelLab Pro Flash surface textures and features for the room-shell prototype, all on cosy-night and
// styled on the v1 armchair. Square-on and in-perspective versions of the painting and rug answer whether a feature is
// generated flat and projected, or generated already at the angle it is seen. Outputs land in out/raw; re-runs skip what exists.
// Run from the repo root: node --env-file=.env prototypes/room-shell/generate.ts [job-id]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createImageProFlash, STYLE_OPTIONS, STYLE_USAGE, type ProFlashRequest } from "../../pipeline/lib/pixellab.ts";

const OUT = join(import.meta.dirname, "out/raw");
const palette = JSON.parse(readFileSync("library/palettes/cosy-night.json", "utf8"));
const anchor = { type: "base64" as const, base64: readFileSync("library/elements/armchair-back-wool-throw-01.png").toString("base64"), format: "png" as const };

const job = (description: string, size: number, prop: boolean, seed: number): ProFlashRequest => ({
  description, seed, image_size: { width: size, height: size }, no_background: prop,
  target_palette: { colors: palette.colours, name: palette.name },
  style_image: { image: anchor, size: { width: 44, height: 48 }, usage_description: STYLE_USAGE },
  style_options: STYLE_OPTIONS,
});

const JOBS: Record<string, ProFlashRequest> = {
  "tex-floor": job("seamless texture of dark polished wooden floorboards seen from directly above, long boards running left to right, staggered joints, evenly lit, no light patches, fills the whole canvas, tiles left to right and top to bottom", 128, false, 7101),
  "tex-wall": job("seamless texture of a dark violet plastered wall with tall thin vertical wooden panels, seen straight on, evenly lit, fills the whole canvas, tiles left to right and top to bottom", 128, false, 7102),
  "tex-ceiling": job("seamless texture of a dark plain plaster ceiling with a faint square grid of shallow coffers, seen straight on from below, evenly lit, fills the whole canvas, tiles left to right and top to bottom", 64, false, 7103),
  "painting-flat": job("framed modern abstract painting hanging on a wall, seen straight on, thin dark wooden frame, warm orange and deep blue shapes, the frame fills the canvas", 64, true, 7104),
  "painting-angled": job("framed modern abstract painting hanging on a left side wall, seen from an angle in one-point perspective, the frame's right edge nearer and taller than its left edge, thin dark wooden frame, warm orange and deep blue shapes", 64, true, 7105),
  "sconce": job("small modern brass wall light, a half-cylinder shade glowing warm yellow, mounted flat on a wall, seen straight on", 64, true, 7106),
  "rug-flat": job("rectangular modern wool rug seen from directly above, deep blue with a cream border and a simple geometric pattern, lying flat, fills the canvas", 128, true, 7107),
  "rug-angled": job("rectangular modern wool rug lying flat on the floor seen from a low angle in one-point perspective, wide and squashed, deep blue with a cream border and a simple geometric pattern", 128, true, 7108),
};

mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
let total = 0;
await Promise.all(Object.entries(JOBS).filter(([id]) => !only || id === only).map(async ([id, body]) => {
  const file = join(OUT, `${id}.png`);
  if (existsSync(file)) return;
  console.log(`start ${id}`);
  try {
    const { png, generations } = await createImageProFlash(body);
    writeFileSync(file, png);
    total += generations;
    console.log(`ok ${id} (${generations} generations)`);
  } catch (e) {
    console.log(`FAIL ${id}: ${(e as Error).message}`);
  }
}));
console.log(`done: ${total} generations`);
