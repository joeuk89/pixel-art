import { join } from "node:path";
import { POSTER_OG_FILE, SCENE_HEIGHT, SCENE_WIDTH, type GalleryEntry, type ScenePlan } from "../../schema/index.ts";
import { readScene } from "./library.ts";
import { SITE_URL } from "./site.ts";
import { validationReport } from "./validation.ts";

const OG_SCALE = 4;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function stub(plan: ScenePlan): string {
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
<meta property="og:description" content="${escapeHtml(plan.description)}">
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

function resolvedScenes(root: string): GalleryEntry[] {
  return validationReport(root).scenes
    .filter((s) => s.status === "resolved")
    .map((s) => readScene(join(root, s.file)))
    .map(({ id, title, createdAt, description }) => ({ id, title, createdAt, description }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export const galleryJson = (root: string) => JSON.stringify(resolvedScenes(root), null, 2) + "\n";
