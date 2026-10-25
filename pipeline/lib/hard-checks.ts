import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import sharp from "sharp";
import { allPlacements, featureFile, POSTER_FILE, POSTER_OG_FILE, ROOM_FILE, roomLayerOf, SCENE_HEIGHT, SCENE_WIDTH, type ScenePlan } from "../../schema/index.ts";
import { decodePng, loadPalette } from "./element-pixels.ts";
import { freshProjection, projectedFeatures } from "./features.ts";
import { posterFrame } from "./poster.ts";
import { roomShellOf } from "./room-shell.ts";
import { galleryJson, stub } from "./stub.ts";
import { validationReport } from "./validation.ts";

export type Check = { name: string; ok: boolean; problems: string[] };

const check = (name: string, problems: string[]): Check => ({ name, ok: problems.length === 0, problems });
const TEST_OUTPUT_BYTES = 256 * 1024 * 1024;

function unresolved(plan: ScenePlan): string[] {
  return allPlacements(plan).filter((p) => p.generate).map((p) => `${p.id} (${p.element}) still has a generate block`);
}

function validation(root: string, file: string): string[] {
  const report = validationReport(root);
  const errors = report.errors.map((e) => `${e.file}: ${e.path || "(root)"}: ${e.message}`);
  const scene = report.scenes.find((s) => resolve(root, s.file) === resolve(root, file));
  if (!scene) return [...errors, `validate did not check ${file}`];
  const pending = scene.status === "resolved" ? [] : scene.pending.map((p) => `${file}: ${p.path || "(root)"}: ${p.message}`);
  return [...errors, ...pending, ...(scene.status === "resolved" ? [] : [`${file} would stay draft`])];
}

const seam = (plan: ScenePlan) => (plan.soundtrack.music.seam ? [] : ["music loop seam is not measured"]);

async function poster(root: string, file: string, plan: ScenePlan): Promise<string[]> {
  const dir = dirname(resolve(root, file));
  const path = join(dir, POSTER_FILE);
  const shown = relative(root, path);
  if (!existsSync(path)) return [`${shown} is missing; run poster`];
  const problems = existsSync(join(dir, POSTER_OG_FILE)) ? [] : [`${relative(root, join(dir, POSTER_OG_FILE))} is missing; run poster`];
  let expected: Uint8ClampedArray;
  try {
    expected = await posterFrame(root, dir, plan);
  } catch (e) {
    return [...problems, `cannot render frame 0: ${(e as Error).message}`];
  }
  const differ = await differingPixels(path, expected);
  if (typeof differ === "string") return [...problems, `${shown} ${differ}; run poster`];
  return differ === 0 ? problems : [...problems, `${shown} differs from frame 0 of the plan in ${differ} pixels; run poster`];
}

async function differingPixels(path: string, expected: Uint8ClampedArray): Promise<number | string> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== SCENE_WIDTH || info.height !== SCENE_HEIGHT) return `is ${info.width}x${info.height}, not ${SCENE_WIDTH}x${SCENE_HEIGHT}`;
  let differ = 0;
  for (let p = 0; p < expected.length; p += 4) {
    if (data[p] !== expected[p] || data[p + 1] !== expected[p + 1] || data[p + 2] !== expected[p + 2] || data[p + 3] !== expected[p + 3]) differ++;
  }
  return differ;
}

async function roomShell(root: string, file: string, plan: ScenePlan): Promise<string[]> {
  if (!roomLayerOf(plan)) return [];
  const path = join(dirname(resolve(root, file)), ROOM_FILE);
  const shown = relative(root, path);
  if (!existsSync(path)) return [`${shown} is missing; run room-shell`];
  let expected: Uint8ClampedArray;
  try {
    expected = roomShellOf(plan, loadPalette(root, plan.palette));
  } catch (e) {
    return [`cannot draw the Room shell: ${(e as Error).message}`];
  }
  const differ = await differingPixels(path, expected);
  if (typeof differ === "string") return [`${shown} ${differ}; run room-shell`];
  return differ === 0 ? [] : [`${shown} differs from a fresh room-shell render in ${differ} pixels; run room-shell`];
}

async function features(root: string, file: string, plan: ScenePlan): Promise<string[]> {
  const dir = dirname(resolve(root, file));
  const palette = loadPalette(root, plan.palette);
  const problems: string[] = [];
  for (const feature of projectedFeatures(plan)) {
    const path = join(dir, featureFile(feature.id));
    const shown = relative(root, path);
    if (!existsSync(path)) {
      problems.push(`${shown} is missing; run project-features`);
      continue;
    }
    let expected;
    try {
      expected = (await freshProjection(root, plan, feature, palette)).pixels;
    } catch (e) {
      problems.push(`cannot project Feature ${feature.id}: ${(e as Error).message}`);
      continue;
    }
    const actual = await decodePng(path);
    if (actual.width !== expected.width || actual.height !== expected.height) {
      problems.push(`${shown} is ${actual.width}x${actual.height}, a fresh projection is ${expected.width}x${expected.height}; run project-features`);
      continue;
    }
    let differ = 0;
    for (let p = 0; p < expected.data.length; p += 4) {
      const transparent = actual.data[p + 3] === 0 && expected.data[p + 3] === 0;
      if (!transparent && [0, 1, 2, 3].some((k) => actual.data[p + k] !== expected.data[p + k])) differ++;
    }
    if (differ > 0) problems.push(`${shown} differs from a fresh projection in ${differ} pixels; run project-features`);
  }
  return problems;
}

function sameFile(path: string, expected: string, shown: string): string[] {
  if (!existsSync(path)) return [`${shown} is missing; run stub`];
  return readFileSync(path, "utf8") === expected ? [] : [`${shown} is not what stub writes; run stub`];
}

function tests(root: string): string[] {
  const run = spawnSync("npm", ["test"], { cwd: root, encoding: "utf8", maxBuffer: TEST_OUTPUT_BYTES });
  if (run.status === 0) return [];
  const failures = `${run.stdout ?? ""}\n${run.stderr ?? ""}`.split("\n").filter((l) => /^not ok /.test(l));
  return [`npm test exited ${run.status ?? run.signal}`, ...failures];
}

export async function hardChecks(root: string, file: string, plan: ScenePlan): Promise<{ ok: boolean; checks: Check[] }> {
  const stubPath = join(dirname(resolve(root, file)), "index.html");
  const checks = [
    check("generate blocks resolved", unresolved(plan)),
    check("validate", validation(root, file)),
    check("loop seam", seam(plan)),
    check("room shell", await roomShell(root, file, plan)),
    check("features", await features(root, file, plan)),
    check("poster", await poster(root, file, plan)),
    check("stub", sameFile(stubPath, stub(plan), relative(root, stubPath))),
    check("gallery", sameFile(join(root, "gallery.json"), galleryJson(root), "gallery.json")),
    check("tests", tests(root)),
  ];
  return { ok: checks.every((c) => c.ok), checks };
}
