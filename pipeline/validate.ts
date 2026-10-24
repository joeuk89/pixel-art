import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { z } from "zod";
import {
  ambientLoopRecordSchema,
  elementRecordSchema,
  paletteSchema,
  POSTER_FILE,
  scenePlanSchema,
  type AmbientLoopRecord,
  type ElementRecord,
  type ScenePlan,
} from "../schema/index.ts";
import { pngSize } from "./lib/png.ts";

type Problem = { path: string; message: string };
type Issue = Problem & { file: string };
type Kind = "scenes" | "elements" | "palettes" | "ambient";
type SceneReport = { id: string; file: string; declared: unknown; status: "draft" | "resolved"; pending: Problem[] };

const root = process.cwd();
const ELEMENTS = "library/elements";
const PALETTES = "library/palettes";
const AMBIENT = "library/ambient";
const SCENES = "scenes";

const errors: Issue[] = [];
const checked: Record<Kind, string[]> = { scenes: [], elements: [], palettes: [], ambient: [] };

function formatPath(path: readonly PropertyKey[]): string {
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join("");
}

function jsonFiles(dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter((n) => n.endsWith(".json")).sort().map((n) => `${dir}/${n}`);
}

function sceneFiles(): string[] {
  const abs = join(root, SCENES);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(abs, d.name, "scene.json")))
    .map((d) => `${SCENES}/${d.name}/scene.json`)
    .sort();
}

function load<S extends z.ZodType>(kind: Kind, file: string, schema: S): { raw: unknown; value?: z.infer<S> } {
  checked[kind].push(file);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(root, file), "utf8"));
  } catch (e) {
    errors.push({ file, path: "", message: `not valid JSON: ${(e as Error).message}` });
    return { raw };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push({ file, path: formatPath(issue.path), message: issue.message });
    return { raw };
  }
  return { raw, value: parsed.data };
}

const stem = (file: string) => basename(file, ".json");

const paletteNames = new Set<string>();
for (const file of jsonFiles(PALETTES)) {
  const { value } = load("palettes", file, paletteSchema);
  paletteNames.add(stem(file));
  if (value && value.name !== stem(file)) errors.push({ file, path: "name", message: `name ${value.name} does not match file name ${stem(file)}` });
}

function checkPng(file: string, path: string, png: string, width: number, height: number, what: string): void {
  const abs = join(root, png);
  if (!existsSync(abs)) {
    errors.push({ file, path, message: `${what} ${png} is missing` });
    return;
  }
  let size: { width: number; height: number };
  try {
    size = pngSize(abs);
  } catch (e) {
    errors.push({ file, path, message: (e as Error).message });
    return;
  }
  if (size.width !== width || size.height !== height) {
    errors.push({ file, path, message: `${what} ${png} is ${size.width}x${size.height}, record says ${width}x${height}` });
  }
}

const elementIds = new Set<string>();
const elements = new Map<string, ElementRecord>();
for (const file of jsonFiles(ELEMENTS)) {
  const { value } = load("elements", file, elementRecordSchema);
  elementIds.add(stem(file));
  if (!value) continue;
  if (value.id !== stem(file)) errors.push({ file, path: "id", message: `id ${value.id} does not match file name ${stem(file)}` });
  elements.set(value.id, value);
  if (!paletteNames.has(value.palette)) errors.push({ file, path: "palette", message: `Palette ${value.palette} does not exist` });
  checkPng(file, "", `${ELEMENTS}/${stem(file)}.png`, value.width, value.height, "Element PNG");
  if (value.kind === "prop" && value.animation) {
    const { frames } = value.animation;
    checkPng(file, "animation.frames", `${ELEMENTS}/${stem(file)}.strip.png`, frames * value.width, value.height, "Frame strip");
  }
}

const sounds = new Map<string, AmbientLoopRecord>();
for (const file of jsonFiles(AMBIENT)) {
  const { value } = load("ambient", file, ambientLoopRecordSchema);
  if (!value) continue;
  if (value.id !== stem(file)) errors.push({ file, path: "id", message: `id ${value.id} does not match file name ${stem(file)}` });
  sounds.set(value.id, value);
  if (!existsSync(join(root, AMBIENT, value.file))) errors.push({ file, path: "file", message: `${value.file} is missing beside the record` });
}

function checkScene(file: string, plan: ScenePlan): { problems: Problem[]; pending: Problem[] } {
  const problems: Problem[] = [];
  const pending: Problem[] = [];
  const folder = basename(dirname(file));
  const beside = (name: string) => existsSync(join(root, dirname(file), name));

  if (plan.id !== folder) problems.push({ path: "id", message: `id ${plan.id} does not match Scene folder ${folder}` });
  if (!paletteNames.has(plan.palette)) problems.push({ path: "palette", message: `Palette ${plan.palette} does not exist` });

  plan.layers.forEach((layer, li) =>
    layer.placements?.forEach((p, pi) => {
      const at = `layers[${li}].placements[${pi}]`;
      const element = elements.get(p.element);
      if (p.generate) pending.push({ path: `${at}.generate`, message: `Element ${p.element} is not generated yet` });
      else if (!elementIds.has(p.element)) problems.push({ path: `${at}.element`, message: `Element ${p.element} is not in the Element library` });

      const stripFrames = (element?.kind === "prop" ? element.animation?.frames : undefined) ??
        (p.generate?.kind === "prop" ? p.generate.strip?.frames : undefined);
      if (p.animation && stripFrames === undefined) {
        problems.push({ path: `${at}.animation`, message: `animation override on a Placement whose Element ${p.element} has no Frame strip` });
      }
      const order = p.animation?.order;
      if (Array.isArray(order) && stripFrames !== undefined) {
        order.forEach((frame, k) => {
          if (frame >= stripFrames) problems.push({ path: `${at}.animation.order[${k}]`, message: `frame ${frame} is beyond the ${stripFrames}-frame strip` });
        });
      }
    }),
  );

  const { music, ambient, oneshots } = plan.soundtrack;
  if (music.file === undefined || music.loopEnd === undefined) {
    pending.push({ path: "soundtrack.music", message: "music is not generated yet" });
  } else if (!beside(music.file)) {
    pending.push({ path: "soundtrack.music.file", message: `${music.file} is missing beside the plan` });
  }
  const entries = [
    ...ambient.map((entry, i) => ({ entry, at: `soundtrack.ambient[${i}]` })),
    ...oneshots.map((entry, i) => ({ entry, at: `soundtrack.oneshots[${i}]` })),
  ];
  for (const { entry, at } of entries) {
    if (entry.source.kind === "curated" && !sounds.has(entry.source.id)) {
      pending.push({ path: `${at}.source.id`, message: `Sound library has no record ${entry.source.id}` });
    }
    if (!beside(entry.file)) pending.push({ path: `${at}.file`, message: `${entry.file} is missing beside the plan` });
  }
  if (!beside(POSTER_FILE)) pending.push({ path: "", message: `${POSTER_FILE} is missing beside the plan` });

  return { problems, pending };
}

const scenes: SceneReport[] = [];
const dependencies = new Map<string, Set<string>>();
for (const file of sceneFiles()) {
  const { raw, value } = load("scenes", file, scenePlanSchema);
  const declared = (raw as { status?: unknown } | undefined)?.status;
  const id = value?.id ?? basename(dirname(file));
  if (!value) {
    scenes.push({ id, file, declared, status: "draft", pending: [] });
    continue;
  }
  const { problems, pending } = checkScene(file, value);
  for (const p of problems) errors.push({ file, ...p });
  if (value.status === "resolved") {
    for (const p of pending) errors.push({ file, path: p.path, message: `declared resolved but ${p.message}` });
  }
  scenes.push({ id, file, declared, status: problems.length === 0 && pending.length === 0 ? "resolved" : "draft", pending });
  dependencies.set(file, referencedFiles(value));
}

function referencedFiles(plan: ScenePlan): Set<string> {
  const files = new Set([`${PALETTES}/${plan.palette}.json`]);
  for (const layer of plan.layers) {
    for (const p of layer.placements ?? []) {
      files.add(`${ELEMENTS}/${p.element}.json`);
      const element = elements.get(p.element);
      if (element) files.add(`${PALETTES}/${element.palette}.json`);
    }
  }
  const { ambient, oneshots } = plan.soundtrack;
  for (const { source } of [...ambient, ...oneshots]) {
    if (source.kind === "curated") files.add(`${AMBIENT}/${source.id}.json`);
  }
  return files;
}

for (const scene of scenes) {
  const files = dependencies.get(scene.file);
  if (!files) continue;
  const failing = [...files].filter((dep) => errors.some((e) => e.file === dep));
  if (failing.length === 0) continue;
  scene.status = "draft";
  if (scene.declared === "resolved") {
    for (const dep of failing) errors.push({ file: scene.file, path: "", message: `declared resolved but ${dep} fails validation` });
  }
}

const targets = process.argv.slice(2).map((p) => resolve(root, p));
const reported = (file: string) => {
  if (targets.length === 0) return true;
  const abs = resolve(root, file);
  return targets.some((t) => abs === t || abs.startsWith(t + sep));
};

const report = {
  ok: false,
  checked: Object.fromEntries(Object.entries(checked).map(([k, files]) => [k, files.filter(reported).length])),
  scenes: scenes.filter((s) => reported(s.file)),
  errors: errors.filter((e) => reported(e.file)).map((e) => ({ ...e, file: relative(root, join(root, e.file)).split(sep).join("/") })),
};
report.ok = report.errors.length === 0;

for (const e of report.errors) process.stderr.write(`${e.file}: ${e.path || "(root)"}: ${e.message}\n`);
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
process.exitCode = report.ok ? 0 : 1;
