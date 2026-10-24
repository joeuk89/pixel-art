import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { elementRecordSchema, isLocal, placementsOf, type ElementRecord, type Placement, type ScenePlan } from "../schema/index.ts";
import { budget } from "./lib/budget.ts";
import { anchorFits, deriveCanvas, layerScale } from "./lib/canvas.ts";
import { main } from "./lib/cli.ts";
import { loadPalette } from "./lib/element-pixels.ts";
import { readElements, readScene } from "./lib/library.ts";
import { checkService, generateImage, parseService, serviceInfo, type ImageService } from "./lib/image-services.ts";
import { PixelLabError } from "./lib/pixellab.ts";
import {
  addMetered, attemptNumbers, attemptStem, attemptTaken, chargeStillAttempts, claimAttempt, freeElementId, logAbandoned, rawPlacement, sidecarOf, stillAttemptsDir,
  type Abandoned, type StillAttempt,
} from "./lib/attempts.ts";
import { editPlan } from "./lib/plan-file.ts";
import { gateStill, upscaleFactor } from "./lib/quality-gate.ts";

const ELEMENTS = "library/elements";
const ANCHOR_MIN_SIDE = 48;
const FILLS_CANVAS = "fills its canvas";
const USAGE = "usage: generate-element <scene.json> <placementId> [--service pro-flash|pro|pixflux|rd-plus] [--attempt n] [--seed n] [--brief text] | --accept <attemptPath> [--style-anchor] | --abandon [--substitute elementId]";

const targetBox = (scale: number, realSize: { w: number; h: number }) => ({ width: scale * realSize.w, height: scale * realSize.h });

const subjectOf = (elementId: string) => elementId.split("-")[0];

function styleAnchor(plan: ScenePlan): { id: string; subject: string; width: number; height: number } | null {
  if (plan.styleAnchor === null) return null;
  const record = readElements().find((e) => e.id === plan.styleAnchor);
  if (!record) throw new Error(`Style anchor ${plan.styleAnchor} is not in the Element library`);
  return { id: record.id, subject: record.subject, width: record.width, height: record.height };
}

type Found = { placement: Placement; scale: number };

function findPlacement(plan: ScenePlan, id: string): Found {
  const layer = plan.layers.find((l) => placementsOf(l).some((p) => p.id === id));
  if (!layer) throw new Error(`no Placement ${id} in Scene ${plan.id}`);
  const placement = placementsOf(layer).find((p) => p.id === id)!;
  if (!placement.generate) throw new Error(`Placement ${id} has no generate block; its Element ${placement.element} is already in the library`);
  return { placement, scale: layerScale(plan.scale, layer) };
}

function checkBudget(plan: ScenePlan, placement: Placement, service: ImageService): void {
  const report = budget(plan);
  const still = report.stills.find((s) => s.placement === placement.id)!;
  if (still.attempts >= still.cap) throw new Error(`${still.placement} (${still.element}) has had ${still.attempts} of ${still.cap} Attempts; abandon it`);
  if (serviceInfo(service).vendor === "pixellab") {
    const { used, cap } = report.pixellabGenerations;
    if (used >= cap) throw new Error(`Scene budget reached: PixelLab generations: ${used} used of ${cap}`);
  } else {
    const { used, cap } = report.meteredUsd;
    if (used >= cap) throw new Error(`Scene budget reached: metered: $${used} used of $${cap}`);
  }
}

async function attempt(plan: ScenePlan, { placement, scale }: Found, opts: { attempt: number | null; seed: number; brief?: string; service: ImageService }) {
  const generate = placement.generate!;
  if (isLocal(generate) || generate.kind === "texture") {
    throw new Error(`Placement ${placement.id} is ${generate.kind === "texture" ? "a Seamless texture" : "a local Finish"}; draw it with draw-element`);
  }
  const dir = stillAttemptsDir(plan.id);
  const canvas = deriveCanvas(scale, generate);
  checkService(opts.service, generate.kind, placement.id, canvas);
  if (opts.attempt !== null && existsSync(dir) && attemptNumbers(dir, placement.id).includes(opts.attempt)) {
    throw new Error(attemptTaken(dir, placement.id, opts.attempt));
  }
  checkBudget(plan, placement, opts.service);
  const palette = loadPalette(process.cwd(), plan.palette);
  const prompt = opts.brief ?? generate.brief;
  const anchor = styleAnchor(plan);
  const sendStyle = anchor !== null && serviceInfo(opts.service).takesStyle && anchorFits(anchor, canvas) && subjectOf(placement.element) !== anchor.subject;
  const style = sendStyle ? { png: readFileSync(join(ELEMENTS, `${anchor.id}.png`)), width: anchor.width, height: anchor.height } : null;

  let result;
  try {
    result = await generateImage({
      service: opts.service, prompt, canvas, seed: opts.seed,
      noBackground: generate.kind === "prop" && generate.removeBackground !== false,
      palette: { name: palette.name, colours: palette.colours }, style,
    });
  } catch (e) {
    if (e instanceof PixelLabError && e.styleImageTooLarge && anchor) {
      throw new Error(`PixelLab rejected the Style anchor ${anchor.id} (${anchor.width}x${anchor.height}): it must fit the ${canvas.width}x${canvas.height} canvas. Send this Attempt without a style image or choose a smaller anchor.`);
    }
    throw e;
  }
  const { png, generations, meteredUsd, params } = result;

  mkdirSync(dir, { recursive: true });
  const attemptNo = claimAttempt(dir, placement.id, opts.attempt, png);
  const stem = attemptStem(dir, placement.id, attemptNo);
  const decoded = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = { width: decoded.info.width, height: decoded.info.height, data: new Uint8Array(decoded.data) };
  const upscale = upscaleFactor(pixels);
  await sharp(png).resize(pixels.width * upscale, pixels.height * upscale, { kernel: "nearest" }).png().toFile(`${stem}.x${upscale}.png`);
  const gate = gateStill(pixels, generate.kind === "prop"
    ? { kind: "prop", canvas, palette: palette.colours, targetBox: targetBox(scale, generate.realSize) }
    : { kind: "backdrop", canvas, palette: palette.colours });

  const sidecar: StillAttempt = {
    scene: plan.id, placement: placement.id, element: placement.element, kind: generate.kind,
    ...(generate.kind === "prop" && generate.strip ? { strip: generate.strip } : {}),
    attempt: attemptNo, canvas, prompt, seed: opts.seed, service: opts.service, generations, meteredUsd, params,
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
    service: opts.service,
    styleImage: { sent: sendStyle, anchor: anchor?.id ?? null },
    generations,
    meteredUsd,
    gate,
    ...(gate.failed.some((f) => f.startsWith("trimmed box:")) ? { retryBrief: `${generate.brief}, ${FILLS_CANVAS}` } : {}),
    upscaleFactor: upscale,
    scratch: { png: `${stem}.png`, upscale: `${stem}.x${upscale}.png`, attempt: `${stem}.json` },
  };
}

function checkAnchor(placement: Placement, canvas: { width: number; height: number }): void {
  if (placement.generate!.kind !== "prop") throw new Error("the Style anchor must be a prop, not a backdrop");
  if (Math.max(canvas.width, canvas.height) < ANCHOR_MIN_SIDE) {
    throw new Error(`the Style anchor must be at least ${ANCHOR_MIN_SIDE} px on its longer side; ${placement.id} is ${canvas.width}x${canvas.height}`);
  }
}

function accept(file: string, plan: ScenePlan, placement: Placement, attemptPath: string, asAnchor: boolean) {
  if (!existsSync(attemptPath) || !existsSync(sidecarOf(attemptPath))) throw new Error(`${attemptPath} is not an Attempt written by generate-element`);
  const attempt = JSON.parse(readFileSync(sidecarOf(attemptPath), "utf8")) as StillAttempt;
  if (attempt.service === "local") throw new Error(`${attemptPath} was drawn by draw-element; accept it with draw-element`);
  if (attempt.scene !== plan.id || attempt.placement !== placement.id) {
    throw new Error(`${attemptPath} is an Attempt for ${attempt.scene}/${attempt.placement}, not ${plan.id}/${placement.id}`);
  }
  if (!attempt.gate.ok) throw new Error(`${attemptPath} failed the Quality gate: ${attempt.gate.failed.join("; ")}`);
  if (asAnchor) checkAnchor(placement, attempt.canvas);

  const generate = placement.generate!;
  const proposed = placement.element;
  const id = freeElementId(proposed);
  const service = serviceInfo(attempt.service ?? "pro-flash");
  const cost = { pixellabGenerations: attempt.generations, meteredUsd: attempt.meteredUsd ?? 0 };
  const base = {
    id,
    subject: id.split("-")[0],
    tags: generate.tags,
    brief: generate.brief,
    prompt: attempt.prompt,
    service: service.vendor,
    model: service.model,
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
    addMetered(raw, charge.meteredByService);
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

function checkSubstitute(plan: ScenePlan, { placement, scale }: Found, id: string): ElementRecord {
  const record = readElements().find((e) => e.id === id);
  if (!record) throw new Error(`no Element ${id} in the Element library`);
  const generate = placement.generate!;
  const canvas = deriveCanvas(scale, generate);
  if (record.kind !== generate.kind) throw new Error(`${id} is a ${record.kind}, ${placement.id} needs a ${generate.kind}`);
  if (record.palette !== plan.palette) throw new Error(`${id} is locked to Palette ${record.palette}, the Scene uses ${plan.palette}`);
  if (record.width !== canvas.width || record.height !== canvas.height) {
    throw new Error(`${id} is ${record.width}x${record.height}, the derived canvas for ${placement.id} is ${canvas.width}x${canvas.height}`);
  }
  return record;
}

function abandon(file: string, plan: ScenePlan, found: Found, substituteId: string | undefined) {
  const { placement } = found;
  const substitute = substituteId === undefined ? undefined : checkSubstitute(plan, found, substituteId);
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
    addMetered(raw, charge.meteredByService);
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
      abandon: { type: "boolean" }, substitute: { type: "string" }, service: { type: "string" },
    },
  });
  const [file, placementId, ...rest] = positionals;
  if (!file || !placementId || rest.length > 0) throw new Error(USAGE);
  const plan = readScene(file);
  const found = findPlacement(plan, placementId);
  if (values.service !== undefined && (values.accept !== undefined || values.abandon)) throw new Error("--service goes with an Attempt, not with --accept or --abandon");
  const service = parseService(values.service);
  if (values.accept !== undefined) return accept(file, plan, found.placement, values.accept, values["style-anchor"] === true);
  if (values["style-anchor"]) throw new Error("--style-anchor goes with --accept");
  if (values.abandon) return abandon(file, plan, found, values.substitute);
  if (values.substitute !== undefined) throw new Error("--substitute goes with --abandon");
  const attemptNo = values.attempt === undefined ? null : Number(values.attempt);
  const seed = values.seed === undefined ? Math.floor(Math.random() * 2 ** 31) : Number(values.seed);
  if (attemptNo !== null && (!Number.isInteger(attemptNo) || attemptNo < 1)) throw new Error(`--attempt must be a positive integer, got ${values.attempt}`);
  if (!Number.isInteger(seed)) throw new Error(`--seed must be an integer, got ${values.seed}`);
  return attempt(plan, found, { attempt: attemptNo, seed, brief: values.brief, service });
});
