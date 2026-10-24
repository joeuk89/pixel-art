import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { allPlacements, elementRecordSchema, type ElementRecord, type Placement, type ScenePlan } from "../schema/index.ts";
import { budget } from "./lib/budget.ts";
import { anchorFits, deriveCanvas } from "./lib/canvas.ts";
import { main } from "./lib/cli.ts";
import { loadPalette } from "./lib/element-pixels.ts";
import { readElements, readScene } from "./lib/library.ts";
import { createImageProFlash, PixelLabError, STYLE_OPTIONS, STYLE_USAGE, type ProFlashRequest } from "./lib/pixellab.ts";
import { chargeStillAttempts, logAbandoned, stillAttemptsDir, type Abandoned, type StillAttempt } from "./lib/attempts.ts";
import { editPlan } from "./lib/plan-file.ts";
import { gateStill } from "./lib/quality-gate.ts";

const UPSCALE = 8;
const ELEMENTS = "library/elements";
const SERVICE = "pixellab";
const MODEL = "pro-flash";
const ANCHOR_MIN_SIDE = 48;
const USAGE = "usage: generate-element <scene.json> <placementId> [--attempt n] [--seed n] [--brief text] | --accept <attemptPath> [--style-anchor] | --abandon [--substitute elementId]";

const targetBox = (scale: number, realSize: { w: number; h: number }) => ({ width: scale * realSize.w, height: scale * realSize.h });

function styleAnchor(plan: ScenePlan): { id: string; width: number; height: number } | null {
  if (plan.styleAnchor === null) return null;
  const record = readElements().find((e) => e.id === plan.styleAnchor);
  if (!record) throw new Error(`Style anchor ${plan.styleAnchor} is not in the Element library`);
  return { id: record.id, width: record.width, height: record.height };
}

function findPlacement(plan: ScenePlan, id: string): Placement {
  const placement = allPlacements(plan).find((p) => p.id === id);
  if (!placement) throw new Error(`no Placement ${id} in Scene ${plan.id}`);
  if (!placement.generate) throw new Error(`Placement ${id} has no generate block; its Element ${placement.element} is already in the library`);
  return placement;
}

const attemptStem = (dir: string, placementId: string, n: number) => `${dir}/${placementId}-a${n}`;

function attemptNumbers(dir: string, placementId: string): number[] {
  const prefix = `${placementId}-a`;
  return readdirSync(dir)
    .filter((n) => n.startsWith(prefix))
    .map((n) => n.slice(prefix.length).match(/^(\d+)\.(png|json)$/)?.[1])
    .filter((n) => n !== undefined)
    .map(Number);
}

function createExclusive(path: string, data: Uint8Array): boolean {
  try {
    writeFileSync(path, data, { flag: "wx" });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

// The PNG is created exclusively, so parallel runs never write over each other's Attempt and lose its generations.
function claimAttempt(dir: string, placementId: string, wanted: number | null, png: Uint8Array): number {
  for (let n = wanted ?? 1 + Math.max(0, ...attemptNumbers(dir, placementId)); ; n++) {
    const stem = attemptStem(dir, placementId, n);
    if (!existsSync(`${stem}.json`) && createExclusive(`${stem}.png`, png)) return n;
    if (wanted !== null) throw new Error(attemptTaken(dir, placementId, n));
  }
}

const attemptTaken = (dir: string, placementId: string, n: number) =>
  `Attempt ${n} of ${basename(dir)}/${placementId} is already in scratch; leave out --attempt to take the next free number`;

function checkBudget(plan: ScenePlan, placement: Placement): void {
  const report = budget(plan);
  const still = report.stills.find((s) => s.placement === placement.id)!;
  if (still.attempts >= still.cap) throw new Error(`${still.placement} (${still.element}) has had ${still.attempts} of ${still.cap} Attempts; abandon it`);
  const { used, cap } = report.pixellabGenerations;
  if (used >= cap) throw new Error(`Scene budget reached: PixelLab generations: ${used} used of ${cap}`);
}

async function attempt(plan: ScenePlan, placement: Placement, opts: { attempt: number | null; seed: number; brief?: string }) {
  const generate = placement.generate!;
  const dir = stillAttemptsDir(plan.id);
  if (opts.attempt !== null && existsSync(dir) && attemptNumbers(dir, placement.id).includes(opts.attempt)) {
    throw new Error(attemptTaken(dir, placement.id, opts.attempt));
  }
  checkBudget(plan, placement);
  const canvas = deriveCanvas(plan.scale, generate);
  const palette = loadPalette(process.cwd(), plan.palette);
  const prompt = opts.brief ?? generate.brief;
  const request: ProFlashRequest = {
    description: prompt,
    image_size: canvas,
    seed: opts.seed,
    no_background: generate.kind === "prop" && generate.removeBackground !== false,
    target_palette: { colors: palette.colours, name: palette.name },
  };
  const anchor = styleAnchor(plan);
  const sendStyle = anchor !== null && anchorFits(anchor, canvas);
  if (sendStyle) {
    const base64 = readFileSync(join(ELEMENTS, `${anchor.id}.png`)).toString("base64");
    request.style_image = { image: { type: "base64", base64, format: "png" }, size: { width: anchor.width, height: anchor.height }, usage_description: STYLE_USAGE };
    request.style_options = STYLE_OPTIONS;
  }

  let result;
  try {
    result = await createImageProFlash(request);
  } catch (e) {
    if (e instanceof PixelLabError && e.styleImageTooLarge && anchor) {
      throw new Error(`PixelLab rejected the Style anchor ${anchor.id} (${anchor.width}x${anchor.height}): it must fit the ${canvas.width}x${canvas.height} canvas. Send this Attempt without a style image or choose a smaller anchor.`);
    }
    throw e;
  }
  const { png, generations } = result;

  mkdirSync(dir, { recursive: true });
  const attemptNo = claimAttempt(dir, placement.id, opts.attempt, png);
  const stem = attemptStem(dir, placement.id, attemptNo);
  const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = { width: decoded.info.width, height: decoded.info.height, data: new Uint8Array(decoded.data) };
  await sharp(png).resize(pixels.width * UPSCALE, pixels.height * UPSCALE, { kernel: "nearest" }).png().toFile(`${stem}.x8.png`);
  const gate = gateStill(pixels, generate.kind === "prop"
    ? { kind: "prop", canvas, palette: palette.colours, targetBox: targetBox(plan.scale, generate.realSize) }
    : { kind: "backdrop", canvas, palette: palette.colours });

  const sidecar: StillAttempt = {
    scene: plan.id, placement: placement.id, element: placement.element, kind: generate.kind,
    ...(generate.kind === "prop" && generate.strip ? { strip: generate.strip } : {}),
    attempt: attemptNo, canvas, prompt, seed: opts.seed, generations,
    params: { no_background: request.no_background, ...(sendStyle ? { style_options: STYLE_OPTIONS } : {}) },
    styleAnchor: sendStyle ? anchor.id : null, gate,
  };
  writeFileSync(`${stem}.json`, JSON.stringify(sidecar, null, 2) + "\n");

  return {
    scene: plan.id,
    placement: placement.id,
    element: placement.element,
    attempt: attemptNo,
    canvas,
    prompt,
    seed: opts.seed,
    styleImage: { sent: sendStyle, anchor: anchor?.id ?? null },
    generations,
    gate,
    scratch: { png: `${stem}.png`, upscale: `${stem}.x8.png`, attempt: `${stem}.json` },
  };
}

const sidecarOf = (png: string) => png.replace(/\.png$/, ".json");

function freeId(proposed: string): string {
  const m = proposed.match(/^(.*)-(\d+)$/)!;
  const taken = (id: string) => existsSync(join(ELEMENTS, `${id}.json`)) || existsSync(join(ELEMENTS, `${id}.png`));
  let n = Number(m[2]);
  let id = proposed;
  while (taken(id)) id = `${m[1]}-${String(++n).padStart(m[2].length, "0")}`;
  return id;
}

const rawPlacement = (raw: any, id: string) => raw.layers.flatMap((l: any) => l.placements ?? []).find((p: any) => p.id === id);

function checkAnchor(placement: Placement, canvas: { width: number; height: number }): void {
  if (placement.generate!.kind !== "prop") throw new Error("the Style anchor must be a prop, not a backdrop");
  if (Math.max(canvas.width, canvas.height) < ANCHOR_MIN_SIDE) {
    throw new Error(`the Style anchor must be at least ${ANCHOR_MIN_SIDE} px on its longer side; ${placement.id} is ${canvas.width}x${canvas.height}`);
  }
}

function accept(file: string, plan: ScenePlan, placement: Placement, attemptPath: string, asAnchor: boolean) {
  if (!existsSync(attemptPath) || !existsSync(sidecarOf(attemptPath))) throw new Error(`${attemptPath} is not an Attempt written by generate-element`);
  const attempt = JSON.parse(readFileSync(sidecarOf(attemptPath), "utf8")) as StillAttempt;
  if (attempt.scene !== plan.id || attempt.placement !== placement.id) {
    throw new Error(`${attemptPath} is an Attempt for ${attempt.scene}/${attempt.placement}, not ${plan.id}/${placement.id}`);
  }
  if (!attempt.gate.ok) throw new Error(`${attemptPath} failed the Quality gate: ${attempt.gate.failed.join("; ")}`);
  if (asAnchor) checkAnchor(placement, attempt.canvas);

  const generate = placement.generate!;
  const proposed = placement.element;
  const id = freeId(proposed);
  const cost = { pixellabGenerations: attempt.generations, meteredUsd: 0 };
  const base = {
    id,
    subject: id.split("-")[0],
    tags: generate.tags,
    brief: generate.brief,
    prompt: attempt.prompt,
    service: SERVICE,
    model: MODEL,
    params: attempt.params,
    seed: attempt.seed,
    palette: plan.palette,
    styleAnchor: attempt.styleAnchor,
    createdAt: new Date().toISOString(),
    firstScene: plan.id,
    cost,
    checks: { attempt: attempt.attempt, passed: attempt.gate.passed, warnings: attempt.gate.warnings },
  };
  const record: ElementRecord = elementRecordSchema.parse(generate.kind === "prop"
    ? { ...base, kind: "prop", ...attempt.canvas, realSize: generate.realSize, transparent: true }
    : { ...base, kind: "backdrop", ...attempt.canvas, transparent: false });

  // Edit the plan as written, so schema defaults are not added to it.
  const charge = chargeStillAttempts(dirname(attemptPath), placement.id);
  editPlan(file, (raw) => {
    const target = rawPlacement(raw, placement.id);
    delete target.generate;
    target.element = id;
    raw.cost.pixellabGenerations += charge.generations;
    if (asAnchor) raw.styleAnchor = id;
  });

  mkdirSync(ELEMENTS, { recursive: true });
  copyFileSync(attemptPath, join(ELEMENTS, `${id}.png`));
  writeFileSync(join(ELEMENTS, `${id}.json`), JSON.stringify(record, null, 2) + "\n");
  charge.commit();

  return {
    scene: plan.id,
    placement: placement.id,
    element: id,
    ...(id !== proposed ? { bumpedFrom: proposed } : {}),
    png: `${ELEMENTS}/${id}.png`,
    record: `${ELEMENTS}/${id}.json`,
    plan: file,
    generationsAdded: charge.generations,
    ...(asAnchor ? { styleAnchor: id } : {}),
    ...(generate.kind === "prop" && generate.strip ? { stripRequested: generate.strip } : {}),
  };
}

function checkSubstitute(plan: ScenePlan, placement: Placement, id: string): ElementRecord {
  const record = readElements().find((e) => e.id === id);
  if (!record) throw new Error(`no Element ${id} in the Element library`);
  const generate = placement.generate!;
  const canvas = deriveCanvas(plan.scale, generate);
  if (record.kind !== generate.kind) throw new Error(`${id} is a ${record.kind}, ${placement.id} needs a ${generate.kind}`);
  if (record.palette !== plan.palette) throw new Error(`${id} is locked to Palette ${record.palette}, the Scene uses ${plan.palette}`);
  if (record.width !== canvas.width || record.height !== canvas.height) {
    throw new Error(`${id} is ${record.width}x${record.height}, the derived canvas for ${placement.id} is ${canvas.width}x${canvas.height}`);
  }
  return record;
}

function abandon(file: string, plan: ScenePlan, placement: Placement, substituteId: string | undefined) {
  const substitute = substituteId === undefined ? undefined : checkSubstitute(plan, placement, substituteId);
  const dir = stillAttemptsDir(plan.id);
  const charge = chargeStillAttempts(dir, placement.id);

  const entry: Abandoned = { placement: placement.id, element: placement.element, attempts: charge.attempts, outcome: substitute ? "substituted" : "dropped" };
  editPlan(file, (raw) => {
    if (substitute) {
      const target = rawPlacement(raw, placement.id);
      delete target.generate;
      target.element = substitute.id;
      if (!(substitute.kind === "prop" && substitute.animation)) delete target.animation;
      entry.substitute = substitute.id;
    } else {
      for (const layer of raw.layers) if (layer.placements) layer.placements = layer.placements.filter((p: any) => p.id !== placement.id);
      const anchored = raw.primitives.filter((p: any) => p.anchor === placement.id);
      raw.primitives = raw.primitives.filter((p: any) => p.anchor !== placement.id);
      entry.droppedPrimitives = anchored.map((p: any) => `${p.type} anchored to ${placement.id}`);
    }
    raw.status = "draft";
    raw.cost.pixellabGenerations += charge.generations;
    raw.cost.attemptsAbandoned += charge.attempts;
  });
  const log = logAbandoned(plan.id, entry);
  charge.commit();
  return { scene: plan.id, ...entry, generationsAdded: charge.generations, plan: file, log };
}

main(async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      attempt: { type: "string" }, seed: { type: "string" }, brief: { type: "string" },
      accept: { type: "string" }, "style-anchor": { type: "boolean" },
      abandon: { type: "boolean" }, substitute: { type: "string" },
    },
  });
  const [file, placementId, ...rest] = positionals;
  if (!file || !placementId || rest.length > 0) throw new Error(USAGE);
  const plan = readScene(file);
  const placement = findPlacement(plan, placementId);
  if (values.accept !== undefined) return accept(file, plan, placement, values.accept, values["style-anchor"] === true);
  if (values["style-anchor"]) throw new Error("--style-anchor goes with --accept");
  if (values.abandon) return abandon(file, plan, placement, values.substitute);
  if (values.substitute !== undefined) throw new Error("--substitute goes with --abandon");
  const attemptNo = values.attempt === undefined ? null : Number(values.attempt);
  const seed = values.seed === undefined ? Math.floor(Math.random() * 2 ** 31) : Number(values.seed);
  if (attemptNo !== null && (!Number.isInteger(attemptNo) || attemptNo < 1)) throw new Error(`--attempt must be a positive integer, got ${values.attempt}`);
  if (!Number.isInteger(seed)) throw new Error(`--seed must be an integer, got ${values.seed}`);
  return attempt(plan, placement, { attempt: attemptNo, seed, brief: values.brief });
});
