import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GalleryEntry } from "../schema/index.ts";
import { main } from "./lib/cli.ts";

const root = process.cwd();
const dist = join(root, "dist");
const next = join(root, "dist.next");
const validateScript = join(dirname(fileURLToPath(import.meta.url)), "validate.ts");

type SceneStatus = { id: string; file: string; status: string };

function validatedScenes(): SceneStatus[] {
  const run = spawnSync(process.execPath, [validateScript], { cwd: root, encoding: "utf8" });
  let report: { ok: boolean; errors: { file: string; path: string; message: string }[]; scenes: SceneStatus[] };
  try {
    report = JSON.parse(run.stdout);
  } catch {
    throw new Error(`validate did not report: ${run.stderr}`);
  }
  if (run.status !== 0 || !report.ok) {
    const first = report.errors[0];
    throw new Error(`validate failed with ${report.errors.length} error(s)${first ? `, first: ${first.file} ${first.path} ${first.message}` : ""}`);
  }
  return report.scenes;
}

function readGallery(): GalleryEntry[] {
  const path = join(root, "gallery.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}

const visible = (path: string) => !basename(path).startsWith(".");

function copy(from: string, to: string): void {
  cpSync(join(root, from), join(next, to), { recursive: true, dereference: true, filter: visible });
}

main(() => {
  if (process.argv.length > 2) throw new Error("usage: assemble");
  for (const file of ["index.html", "viewer.js", "NOTICE.md"]) {
    if (!existsSync(join(root, file))) throw new Error(`${file} is missing${file === "viewer.js" ? "; run npm run bundle first" : ""}`);
  }
  const scenes = validatedScenes();
  const resolved = scenes.filter((s) => s.status === "resolved");
  const unstaged = resolved.filter((s) => !existsSync(join(root, dirname(s.file), "index.html"))).map((s) => s.id);
  if (unstaged.length > 0) throw new Error(`resolved Scenes have no index.html stub; run stage on: ${unstaged.join(", ")}`);
  const published = new Set(resolved.map((s) => s.id));
  const gallery = readGallery();
  const unpublished = gallery.filter((entry) => !published.has(entry.id)).map((entry) => entry.id);
  if (unpublished.length > 0) throw new Error(`gallery.json lists Scenes that are not resolved: ${unpublished.join(", ")}`);

  rmSync(next, { recursive: true, force: true });
  for (const file of ["index.html", "viewer.js", "NOTICE.md", "library"]) copy(file, file);
  for (const scene of resolved) copy(dirname(scene.file), dirname(scene.file));
  if (existsSync(join(root, "gallery.json"))) copy("gallery.json", "gallery.json");
  else writeFileSync(join(next, "gallery.json"), "[]\n");
  rmSync(dist, { recursive: true, force: true });
  renameSync(next, dist);

  return {
    dist: "dist",
    scenes: resolved.map((s) => s.id),
    skipped: scenes.filter((s) => s.status !== "resolved").map((s) => s.id),
  };
});
