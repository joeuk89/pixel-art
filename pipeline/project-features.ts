import { resolve } from "node:path";
import { main } from "./lib/cli.ts";
import { loadPalette } from "./lib/element-pixels.ts";
import { writeProjections } from "./lib/features.ts";
import { readScene } from "./lib/library.ts";

const root = process.cwd();

main(async () => {
  const [file, ...ids] = process.argv.slice(2);
  if (!file) throw new Error("usage: project-features <scene.json> [placementId...]");
  const planPath = resolve(root, file);
  const plan = readScene(planPath);
  return { scene: plan.id, ...(await writeProjections(root, planPath, plan, loadPalette(root, plan.palette), ids)) };
});
