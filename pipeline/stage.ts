import { writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { POSTER_OG_FILE, SCENE_HEIGHT, SCENE_WIDTH, type GalleryEntry, type ScenePlan } from "../schema/index.ts";
import { main } from "./lib/cli.ts";
import { readScene } from "./lib/library.ts";
import { DEV_URL, SITE_URL } from "./lib/site.ts";
import { validationReport } from "./lib/validation.ts";

const OG_SCALE = 4;
const root = process.cwd();

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function stub(plan: ScenePlan): string {
  const page = `${SITE_URL}scenes/${plan.id}/`;
  const title = escapeHtml(plan.title);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" href="data:,">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${escapeHtml(plan.prompt)}">
<meta property="og:url" content="${page}">
<meta property="og:image" content="${page}${POSTER_OG_FILE}">
<meta property="og:image:width" content="${SCENE_WIDTH * OG_SCALE}">
<meta property="og:image:height" content="${SCENE_HEIGHT * OG_SCALE}">
<meta name="twitter:card" content="summary_large_image">
<script src="../../viewer.js" defer></script>
</head>
<body></body>
</html>
`;
}

function resolvedScenes(): GalleryEntry[] {
  return validationReport(root).scenes
    .filter((s) => s.status === "resolved")
    .map((s) => readScene(join(root, s.file)))
    .map(({ id, title, createdAt, prompt }) => ({ id, title, createdAt, prompt }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

main(() => {
  const [file, ...rest] = process.argv.slice(2);
  if (!file || rest.length > 0) throw new Error("usage: stage <scene.json>");
  const planPath = resolve(root, file);
  const plan = readScene(planPath);
  const gallery = resolvedScenes();

  const stubPath = join(dirname(planPath), "index.html");
  writeFileSync(stubPath, stub(plan));
  writeFileSync(join(root, "gallery.json"), JSON.stringify(gallery, null, 2) + "\n");
  return { scene: plan.id, stub: relative(root, stubPath), gallery: "gallery.json", previewUrl: `${DEV_URL}scenes/${plan.id}/` };
});
