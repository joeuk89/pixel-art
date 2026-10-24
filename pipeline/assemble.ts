import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { GalleryEntry } from "../schema/index.ts";
import { main } from "./lib/cli.ts";
import { validationReport, type SceneStatus } from "./lib/validation.ts";

const root = process.cwd();
const dist = join(root, "dist");
const next = join(root, "dist.next");
const galleryPath = join(root, "gallery.json");
const SITE_FILES = ["index.html", "viewer.js", "NOTICE.md"];

function validatedScenes(): SceneStatus[] {
  const report = validationReport(root);
  if (!report.ok) {
    const first = report.errors[0];
    throw new Error(`validate failed with ${report.errors.length} error(s)${first ? `, first: ${first.file} ${first.path} ${first.message}` : ""}`);
  }
  return report.scenes;
}

const visible = (path: string) => !basename(path).startsWith(".");

function copy(path: string): void {
  cpSync(join(root, path), join(next, path), { recursive: true, dereference: true, filter: visible });
}

main(() => {
  if (process.argv.length > 2) throw new Error("usage: assemble");
  for (const file of SITE_FILES) {
    if (!existsSync(join(root, file))) throw new Error(`${file} is missing${file === "viewer.js" ? "; run npm run bundle first" : ""}`);
  }
  const scenes = validatedScenes();
  const resolved = scenes.filter((s) => s.status === "resolved");
  const unstubbed = resolved.filter((s) => !existsSync(join(root, dirname(s.file), "index.html"))).map((s) => s.id);
  if (unstubbed.length > 0) throw new Error(`resolved Scenes have no index.html stub; run stub on: ${unstubbed.join(", ")}`);
  const published = new Set(resolved.map((s) => s.id));
  const hasGallery = existsSync(galleryPath);
  const gallery: GalleryEntry[] = hasGallery ? JSON.parse(readFileSync(galleryPath, "utf8")) : [];
  const unpublished = gallery.filter((entry) => !published.has(entry.id)).map((entry) => entry.id);
  if (unpublished.length > 0) throw new Error(`gallery.json lists Scenes that are not resolved: ${unpublished.join(", ")}`);

  rmSync(next, { recursive: true, force: true });
  for (const path of [...SITE_FILES, "library", ...resolved.map((s) => dirname(s.file))]) copy(path);
  if (hasGallery) copy("gallery.json");
  else writeFileSync(join(next, "gallery.json"), "[]\n");
  rmSync(dist, { recursive: true, force: true });
  renameSync(next, dist);

  return {
    dist: "dist",
    scenes: resolved.map((s) => s.id),
    skipped: scenes.filter((s) => s.status !== "resolved").map((s) => s.id),
  };
});
