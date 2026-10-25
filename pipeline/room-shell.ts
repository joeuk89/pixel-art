import { dirname, join, relative, resolve } from "node:path";
import sharp from "sharp";
import { ROOM_FILE, SCENE_HEIGHT, SCENE_WIDTH } from "../schema/index.ts";
import { main } from "./lib/cli.ts";
import { loadPalette } from "./lib/element-pixels.ts";
import { readScene } from "./lib/library.ts";
import { roomShellOf } from "./lib/room-shell.ts";

const root = process.cwd();

main(async () => {
  const [file, ...rest] = process.argv.slice(2);
  if (!file || rest.length > 0) throw new Error("usage: room-shell <scene.json>");
  const planPath = resolve(root, file);
  const plan = readScene(planPath);
  const pixels = roomShellOf(plan, loadPalette(root, plan.palette));
  const out = join(dirname(planPath), ROOM_FILE);
  await sharp(pixels, { raw: { width: SCENE_WIDTH, height: SCENE_HEIGHT, channels: 4 } }).png().toFile(out);
  return { scene: plan.id, room: relative(root, out) };
});
