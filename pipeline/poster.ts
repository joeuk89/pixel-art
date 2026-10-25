import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import sharp from "sharp";
import { POSTER_FILE, POSTER_OG_FILE, POSTER_OG_SCALE, SCENE_HEIGHT, SCENE_WIDTH, scenePlanSchema } from "../schema/index.ts";
import { posterFrame } from "./lib/poster.ts";

const root = process.cwd();

async function main(arg: string | undefined) {
  if (!arg) throw new Error("usage: poster <scene.json>");
  const planPath = resolve(root, arg);
  const plan = scenePlanSchema.parse(JSON.parse(readFileSync(planPath, "utf8")));
  const frame = await posterFrame(root, dirname(planPath), plan);

  const raw = { raw: { width: SCENE_WIDTH, height: SCENE_HEIGHT, channels: 4 as const } };
  const dir = dirname(planPath);
  const posterPath = join(dir, POSTER_FILE);
  const ogPath = join(dir, POSTER_OG_FILE);
  await sharp(frame, raw).png().toFile(posterPath);
  await sharp(frame, raw)
    .resize(SCENE_WIDTH * POSTER_OG_SCALE, SCENE_HEIGHT * POSTER_OG_SCALE, { kernel: "nearest" })
    .png()
    .toFile(ogPath);
  return { ok: true, scene: plan.id, poster: relative(root, posterPath), og: relative(root, ogPath) };
}

try {
  process.stdout.write(JSON.stringify(await main(process.argv[2])) + "\n");
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: (e as Error).message }) + "\n");
  process.exitCode = 1;
}
