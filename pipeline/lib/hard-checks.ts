import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import sharp from "sharp";
import { allPlacements, POSTER_FILE, POSTER_OG_FILE, SCENE_HEIGHT, SCENE_WIDTH, type ScenePlan } from "../../schema/index.ts";
import { posterFrame } from "./poster.ts";
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
    expected = await posterFrame(root, plan);
  } catch (e) {
    return [...problems, `cannot render frame 0: ${(e as Error).message}`];
  }
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== SCENE_WIDTH || info.height !== SCENE_HEIGHT) return [...problems, `${shown} is ${info.width}x${info.height}, not ${SCENE_WIDTH}x${SCENE_HEIGHT}; run poster`];
  let differ = 0;
  for (let p = 0; p < expected.length; p += 4) {
    if (data[p] !== expected[p] || data[p + 1] !== expected[p + 1] || data[p + 2] !== expected[p + 2] || data[p + 3] !== expected[p + 3]) differ++;
  }
  return differ === 0 ? problems : [...problems, `${shown} differs from frame 0 of the plan in ${differ} pixels; run poster`];
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
    check("poster", await poster(root, file, plan)),
    check("stub", sameFile(stubPath, stub(plan), relative(root, stubPath))),
    check("gallery", sameFile(join(root, "gallery.json"), galleryJson(root), "gallery.json")),
    check("tests", tests(root)),
  ];
  return { ok: checks.every((c) => c.ok), checks };
}
