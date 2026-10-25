import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { elementRecordSchema, isLocal, placementsOf, type ElementRecord, type Placement, type ScenePlan } from "../schema/index.ts";
import {
  addMetered, attemptNumbers, attemptStem, attemptTaken, chargeStillAttempts, claimAttempt, freeElementId, rawPlacement, sidecarOf, stillAttemptsDir,
  type StillAttempt,
} from "./lib/attempts.ts";
import { deriveCanvas, placementScale } from "./lib/canvas.ts";
import { main } from "./lib/cli.ts";
import { loadPalette } from "./lib/element-pixels.ts";
import { drawLocal, generatorOf } from "./lib/kits/index.ts";
import { readScene } from "./lib/library.ts";
import { projectAccepted } from "./lib/features.ts";
import { emissiveOf, parseEmissive, type EmissiveChoice } from "./lib/emissive.ts";
import { editPlan } from "./lib/plan-file.ts";
import { gateStill, upscaleFactor } from "./lib/quality-gate.ts";

const ELEMENTS = "library/elements";
const USAGE = "usage: draw-element <scene.json> <placementId> [--generator name] [--param key=value...] [--attempt n] | --accept <attemptPath> [--emissive i,j [--emissive-region x,y,w,h]...]";

type Found = { placement: Placement; scale: number };

function findPlacement(plan: ScenePlan, id: string): Found {
  const layer = plan.layers.find((l) => placementsOf(l).some((p) => p.id === id));
  if (!layer) throw new Error(`no Placement ${id} in Scene ${plan.id}`);
  const placement = placementsOf(layer).find((p) => p.id === id)!;
  const generate = placement.generate;
  if (!generate) throw new Error(`Placement ${id} has no generate block; its Element ${placement.element} is already in the library`);
  if (!isLocal(generate)) {
    throw new Error(`Placement ${id} asks for a ${generate.kind === "backdrop" ? "Backdrop, which is never local" : "service Finish"}; draw it with generate-element, or set finish: local with a generator and params`);
  }
  return { placement, scale: placementScale(plan, layer, placement) };
}

function parseParams(pairs: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at <= 0) throw new Error(`--param takes key=value, got ${pair}`);
    params[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return params;
}

async function attempt(plan: ScenePlan, { placement, scale }: Found, opts: { generator?: string; params: Record<string, string>; attempt: number | null }) {
  const generate = placement.generate!;
  if (generate.kind === "backdrop") throw new Error(`Placement ${placement.id} is a Backdrop, which is never local`);
  const generator = opts.generator ?? generate.generator;
  if (generator === undefined) throw new Error(`Placement ${placement.id} names no generator; pass --generator`);
  const kit = generatorOf(generator);
  if (kit.kind !== generate.kind) throw new Error(`generator ${generator} draws a ${kit.kind}; Placement ${placement.id} needs a ${generate.kind}`);
  const planParams = generator === generate.generator ? (generate.params ?? {}) : {};

  const dir = stillAttemptsDir(plan.id);
  if (opts.attempt !== null && existsSync(dir) && attemptNumbers(dir, placement.id).includes(opts.attempt)) {
    throw new Error(attemptTaken(dir, placement.id, opts.attempt));
  }
  const palette = loadPalette(process.cwd(), plan.palette);
  const canvas = deriveCanvas(scale, generate);
  const target = generate.kind === "prop" ? { width: scale * generate.realSize.w, height: scale * generate.realSize.h } : undefined;
  const { pixels, params } = drawLocal(generator, { ...planParams, ...opts.params }, { canvas, target, palette });
  const png = await sharp(pixels.data, { raw: { width: pixels.width, height: pixels.height, channels: 4 } }).png().toBuffer();

  mkdirSync(dir, { recursive: true });
  const attemptNo = claimAttempt(dir, placement.id, opts.attempt, png);
  const stem = attemptStem(dir, placement.id, attemptNo);
  const upscale = upscaleFactor(pixels);
  await sharp(png).resize(pixels.width * upscale, pixels.height * upscale, { kernel: "nearest" }).png().toFile(`${stem}.x${upscale}.png`);
  const gate = gateStill(pixels, target
    ? { kind: "prop", canvas, palette: palette.colours, targetBox: target }
    : { kind: "texture", canvas, palette: palette.colours });

  const seed = typeof params.seed === "number" ? params.seed : null;
  const sidecar: StillAttempt = {
    scene: plan.id, placement: placement.id, element: placement.element, kind: generate.kind,
    attempt: attemptNo, canvas, prompt: generate.brief, seed, service: "local", generator, generations: 0, meteredUsd: 0, params,
    styleAnchor: null, gate,
  };
  writeFileSync(`${stem}.json`, JSON.stringify(sidecar, null, 2) + "\n");

  return {
    scene: plan.id,
    placement: placement.id,
    element: placement.element,
    attempt: attemptNo,
    canvas,
    prompt: generate.brief,
    seed,
    service: "local",
    generator,
    params,
    generations: 0,
    meteredUsd: 0,
    gate,
    upscaleFactor: upscale,
    scratch: { png: `${stem}.png`, upscale: `${stem}.x${upscale}.png`, attempt: `${stem}.json` },
  };
}

async function accept(file: string, plan: ScenePlan, placement: Placement, attemptPath: string, emissiveChoice: EmissiveChoice | null) {
  const sidecarPath = sidecarOf(attemptPath);
  const attempt = existsSync(attemptPath) && existsSync(sidecarPath) ? (JSON.parse(readFileSync(sidecarPath, "utf8")) as StillAttempt) : null;
  if (!attempt || attempt.service !== "local" || attempt.generator === undefined) throw new Error(`${attemptPath} is not an Attempt written by draw-element`);
  if (attempt.scene !== plan.id || attempt.placement !== placement.id) {
    throw new Error(`${attemptPath} is an Attempt for ${attempt.scene}/${attempt.placement}, not ${plan.id}/${placement.id}`);
  }
  if (!attempt.gate.ok) throw new Error(`${attemptPath} failed the Quality gate: ${attempt.gate.failed.join("; ")}`);
  const emissive = emissiveChoice ? await emissiveOf(attemptPath, loadPalette(process.cwd(), plan.palette).colours, emissiveChoice) : null;

  const generate = placement.generate!;
  const proposed = placement.element;
  const id = freeElementId(proposed);
  const base = {
    id,
    subject: id.split("-")[0],
    tags: generate.tags,
    brief: generate.brief,
    prompt: attempt.prompt,
    service: "local",
    model: `kit/${attempt.generator}`,
    generator: attempt.generator,
    params: attempt.params,
    seed: attempt.seed,
    palette: plan.palette,
    styleAnchor: null,
    createdAt: new Date().toISOString(),
    firstScene: plan.id,
    cost: { pixellabGenerations: 0, meteredUsd: 0 },
    checks: { attempt: attempt.attempt, passed: attempt.gate.passed, warnings: attempt.gate.warnings },
    ...emissive?.fields,
  };
  const record: ElementRecord = elementRecordSchema.parse(generate.kind === "prop"
    ? { ...base, kind: "prop", ...attempt.canvas, realSize: generate.realSize, transparent: true }
    : { ...base, kind: "texture", ...attempt.canvas, transparent: attempt.gate.measurements.transparentPixels > 0, seamless: true });

  const charge = chargeStillAttempts(dirname(attemptPath), placement.id);
  editPlan(file, (raw) => {
    const target = rawPlacement(raw, placement.id);
    delete target.generate;
    target.element = id;
    raw.cost.pixellabGenerations += charge.generations;
    addMetered(raw, charge.meteredByService);
  });

  mkdirSync(ELEMENTS, { recursive: true });
  copyFileSync(attemptPath, join(ELEMENTS, `${id}.png`));
  writeFileSync(join(ELEMENTS, `${id}.json`), JSON.stringify(record, null, 2) + "\n");
  emissive?.write(join(ELEMENTS, `${id}.emissive.png`));
  charge.commit();
  const projection = await projectAccepted(process.cwd(), file, placement.id, loadPalette(process.cwd(), plan.palette));

  return {
    scene: plan.id,
    placement: placement.id,
    element: id,
    ...(id !== proposed ? { bumpedFrom: proposed } : {}),
    png: `${ELEMENTS}/${id}.png`,
    record: `${ELEMENTS}/${id}.json`,
    plan: file,
    generationsAdded: charge.generations,
    ...projection,
  };
}

main(async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      generator: { type: "string" }, param: { type: "string", multiple: true }, attempt: { type: "string" }, accept: { type: "string" },
      emissive: { type: "string" }, "emissive-region": { type: "string", multiple: true },
    },
  });
  const [file, placementId, ...rest] = positionals;
  if (!file || !placementId || rest.length > 0) throw new Error(USAGE);
  const plan = readScene(file);
  const found = findPlacement(plan, placementId);
  if (values.accept !== undefined) {
    if (values.generator !== undefined || values.param !== undefined || values.attempt !== undefined) throw new Error("--accept takes no --generator, --param or --attempt");
    return accept(file, plan, found.placement, values.accept, parseEmissive(values.emissive, values["emissive-region"]));
  }
  if (values.emissive !== undefined || values["emissive-region"] !== undefined) throw new Error("--emissive goes with --accept");
  const attemptNo = values.attempt === undefined ? null : Number(values.attempt);
  if (attemptNo !== null && (!Number.isInteger(attemptNo) || attemptNo < 1)) throw new Error(`--attempt must be a positive integer, got ${values.attempt}`);
  return attempt(plan, found, { generator: values.generator, params: parseParams(values.param ?? []), attempt: attemptNo });
});
