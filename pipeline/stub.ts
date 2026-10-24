import { writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { main } from "./lib/cli.ts";
import { readScene } from "./lib/library.ts";
import { DEV_URL } from "./lib/site.ts";
import { galleryJson, stub } from "./lib/stub.ts";

const root = process.cwd();

main(() => {
  const [file, ...rest] = process.argv.slice(2);
  if (!file || rest.length > 0) throw new Error("usage: stub <scene.json>");
  const planPath = resolve(root, file);
  const plan = readScene(planPath);
  const gallery = galleryJson(root);

  const stubPath = join(dirname(planPath), "index.html");
  writeFileSync(stubPath, stub(plan));
  writeFileSync(join(root, "gallery.json"), gallery);
  return { scene: plan.id, stub: relative(root, stubPath), gallery: "gallery.json", previewUrl: `${DEV_URL}scenes/${plan.id}/` };
});
