import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { DEFAULT_STRIP_FRAMES, elementRecordSchema, isPixelLabFrames, scenePlanSchema, type ElementRecord, type StripService } from "../schema/index.ts";
import { main } from "./lib/cli.ts";
import { loadPalette } from "./lib/element-pixels.ts";
import { animateWithTextV3 } from "./lib/pixellab.ts";
import type { Pixels } from "./lib/quality-gate.ts";
import { SUBTLE_MOTION, subtleMotion } from "./lib/retro-diffusion.ts";
import { withFreshKey, type Retry } from "./lib/retry.ts";
import { logAbandoned, type Abandoned } from "./lib/attempts.ts";
import { budget, STRIPS_DIR } from "./lib/budget.ts";
import { readScene } from "./lib/library.ts";
import { editPlan } from "./lib/plan-file.ts";
import { buildStrip, gateStrip, snapToPalette, type StripGateReport } from "./lib/strip.ts";

const UPSCALE = 8;
const ELEMENTS = "library/elements";
const SCRATCH = STRIPS_DIR;
const SERVICES: readonly StripService[] = ["pixellab", "retro-diffusion"];
const MODELS: Record<StripService, string> = { pixellab: "animate-with-text-v3", "retro-diffusion": SUBTLE_MOTION };
const USAGE = "usage: generate-strip <elementId> [--service pixellab|retro-diffusion] [--frames n] [--motion text] [--seed n] [--scene scene.json] | --accept <attempt.strip.png> [--scene scene.json] | --abandon --scene scene.json";

type Prop = Extract<ElementRecord, { kind: "prop" }>;

function readProp(id: string): Prop {
  const file = join(ELEMENTS, `${id}.json`);
  if (!existsSync(file)) throw new Error(`no Element ${id} in the Element library`);
  const record = elementRecordSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  if (record.kind !== "prop") throw new Error(`${id} is a backdrop; Frame strips are props only`);
  if (record.animation) throw new Error(`${id} already has a Frame strip; an Element keeps at most one`);
  return record;
}

async function decode(png: Buffer): Promise<Pixels> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

const encode = (p: Pixels) => sharp(p.data, { raw: { width: p.width, height: p.height, channels: 4 } }).png().toBuffer();

type Generated = { frames: Pixels[]; params: Record<string, unknown>; cost: { pixellabGenerations: number; meteredUsd: number } };

async function generatePixelLab(still: Buffer, motion: string, frames: number, seed: number): Promise<Generated> {
  const params = { frame_count: frames - 1, no_background: true };
  const { pngs, generations } = await animateWithTextV3({
    first_frame: { type: "base64", base64: still.toString("base64"), format: "png" },
    action: motion,
    seed,
    ...params,
  });
  const decoded = await Promise.all(pngs.map(decode));
  return { frames: [await decode(still), ...decoded.slice(1)], params, cost: { pixellabGenerations: generations, meteredUsd: 0 } };
}

// Retro Diffusion's frame 0 only approximates the input, so the library still replaces it.
async function generateRetroDiffusion(still: Buffer, record: Prop, motion: string, frames: number, seed: number, key: string): Promise<Generated> {
  const params = { prompt_style: SUBTLE_MOTION, frames_duration: frames };
  const result = await subtleMotion(
    { prompt: motion, width: record.width, height: record.height, seed, frames_duration: frames, input_image: still.toString("base64") },
    key,
  );
  return { frames: [await decode(still), ...result.frames.slice(1)], params, cost: { pixellabGenerations: 0, meteredUsd: result.costUsd } };
}

type Sidecar = {
  element: string;
  attempt: number;
  service: StripService;
  model: string;
  frames: number;
  prompt: string;
  seed: number;
  params: Record<string, unknown>;
  cost: { pixellabGenerations: number; meteredUsd: number };
  snappedTo: string;
  offPaletteBefore: number;
  retries: Retry[];
  gate: StripGateReport;
  charged?: boolean;
};

function attemptSidecars(dir: string, id: string): { name: string; attempt: number }[] {
  const prefix = `${id}-a`;
  return readdirSync(dir).flatMap((name) => {
    const n = name.startsWith(prefix) ? name.slice(prefix.length).match(/^(\d+)\.json$/)?.[1] : undefined;
    return n === undefined ? [] : [{ name, attempt: Number(n) }];
  });
}

const nextAttempt = (id: string) => 1 + Math.max(0, ...attemptSidecars(SCRATCH, id).map((a) => a.attempt));

function createExclusive(path: string, data: string): boolean {
  try {
    writeFileSync(path, data, { flag: "wx" });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

async function attempt(record: Prop, opts: { service: StripService; frames: number; motion: string; seed: number }) {
  const palette = loadPalette(process.cwd(), record.palette);
  const still = readFileSync(join(ELEMENTS, `${record.id}.png`));
  const { value: generated, retries } = await withFreshKey((key) => opts.service === "pixellab"
    ? generatePixelLab(still, opts.motion, opts.frames, opts.seed)
    : generateRetroDiffusion(still, record, opts.motion, opts.frames, opts.seed, key));

  const snapped = generated.frames.map((f) => snapToPalette(f, palette.colours));
  const opaque = snapped.reduce((s, f) => s + f.opaque, 0);
  const offPaletteBefore = opaque === 0 ? 0 : snapped.reduce((s, f) => s + f.offPalette, 0) / opaque;
  const frames = snapped.map((f) => f.frame);
  const gate = gateStrip(frames, { width: record.width, height: record.height, frames: opts.frames, palette: palette.colours, offPaletteBefore });
  const strip = buildStrip(frames);

  mkdirSync(SCRATCH, { recursive: true });
  let n = nextAttempt(record.id);
  const sidecar = (attemptNo: number): Sidecar => ({
    element: record.id, attempt: attemptNo, service: opts.service, model: MODELS[opts.service], frames: opts.frames,
    prompt: opts.motion, seed: opts.seed, params: generated.params, cost: generated.cost,
    snappedTo: palette.name, offPaletteBefore: gate.measurements.offPaletteBefore, retries, gate,
  });
  while (!createExclusive(join(SCRATCH, `${record.id}-a${n}.json`), JSON.stringify(sidecar(n), null, 2) + "\n")) n++;
  const stem = `${SCRATCH}/${record.id}-a${n}`;
  const png = await encode(strip);
  writeFileSync(`${stem}.strip.png`, png);
  await sharp(png).resize(strip.width * UPSCALE, strip.height * UPSCALE, { kernel: "nearest" }).png().toFile(`${stem}.x8.png`);

  return {
    element: record.id,
    attempt: n,
    service: opts.service,
    model: MODELS[opts.service],
    frames: opts.frames,
    prompt: opts.motion,
    seed: opts.seed,
    cost: generated.cost,
    retries,
    gate,
    scratch: { strip: `${stem}.strip.png`, upscale: `${stem}.x8.png`, attempt: `${stem}.json` },
  };
}

const sidecarOf = (strip: string) => strip.replace(/\.strip\.png$/, ".json");
const round = (n: number) => Math.round(n * 10000) / 10000;

// Every Attempt costs, accepted or not; marking them charged keeps a later accept or fallback from charging them again.
function chargeAttempts(dir: string, id: string) {
  const open = attemptSidecars(dir, id)
    .map((a) => ({ file: join(dir, a.name), value: JSON.parse(readFileSync(join(dir, a.name), "utf8")) as Sidecar }))
    .filter((a) => !a.value.charged);
  const meteredByService: Record<string, number> = {};
  for (const { value: a } of open) if (a.cost.meteredUsd > 0) meteredByService[a.service] = round((meteredByService[a.service] ?? 0) + a.cost.meteredUsd);
  return {
    attempts: open.length,
    cost: {
      pixellabGenerations: open.reduce((sum, a) => sum + a.value.cost.pixellabGenerations, 0),
      meteredUsd: round(Object.values(meteredByService).reduce((sum, usd) => sum + usd, 0)),
    },
    meteredByService,
    commit: () => {
      for (const a of open) writeFileSync(a.file, JSON.stringify({ ...a.value, charged: true }, null, 2) + "\n");
    },
  };
}

function chargePlan(plan: any, charge: ReturnType<typeof chargeAttempts>): void {
  plan.cost.pixellabGenerations += charge.cost.pixellabGenerations;
  for (const [name, usd] of Object.entries(charge.meteredByService)) plan.cost.meteredUsd[name] = round((plan.cost.meteredUsd[name] ?? 0) + usd);
}

function checkBudget(sceneFile: string, record: Prop, service: StripService): void {
  const report = budget(readScene(sceneFile));
  const { pixellabGenerations: gens, meteredUsd: metered, retroDiffusion: rd } = report;
  if (gens.used >= gens.cap) throw new Error(`Scene budget reached: PixelLab generations: ${gens.used} used of ${gens.cap}`);
  if (metered.used >= metered.cap) throw new Error(`Scene budget reached: metered: $${metered.used} used of $${metered.cap}`);
  if (service !== "retro-diffusion") return;
  const mine = rd.props.find((p) => p.element === record.id);
  if (mine && mine.attempts >= rd.attemptCap) throw new Error(`Retro Diffusion: ${record.id} has had ${mine.attempts} of ${rd.attemptCap} charged Attempts; use PixelLab or fall back to the still`);
  if (!mine && rd.props.length >= rd.propCap) throw new Error(`Retro Diffusion: ${rd.props.length} of ${rd.propCap} props in this Scene already; use PixelLab or fall back to the still`);
}

function fallBack(record: Prop, sceneFile: string) {
  const charge = chargeAttempts(SCRATCH, record.id);
  const ids = editPlan(sceneFile, (plan) => {
    const placements = plan.layers.flatMap((l: any) => l.placements ?? []).filter((p: any) => p.element === record.id);
    if (placements.length === 0) throw new Error(`no Placement in ${sceneFile} uses ${record.id}`);
    for (const p of placements) delete p.animation;
    chargePlan(plan, charge);
    plan.cost.attemptsAbandoned += charge.attempts;
    plan.status = "draft";
    return placements.map((p: any) => p.id as string);
  });
  const entry: Abandoned = { placement: ids.join(", "), element: record.id, attempts: charge.attempts, outcome: "still" };
  const log = logAbandoned(readScene(sceneFile).id, entry);
  charge.commit();
  return { ...entry, cost: charge.cost, plan: sceneFile, log };
}

function accept(record: Prop, stripPath: string, sceneFile: string | undefined) {
  if (!existsSync(stripPath) || !existsSync(sidecarOf(stripPath))) throw new Error(`${stripPath} is not an Attempt written by generate-strip`);
  const attempt = JSON.parse(readFileSync(sidecarOf(stripPath), "utf8")) as Sidecar;
  if (attempt.element !== record.id) throw new Error(`${stripPath} is a strip Attempt for ${attempt.element}, not ${record.id}`);
  if (!attempt.gate.ok) throw new Error(`${stripPath} failed the strip Quality gate: ${attempt.gate.failed.join("; ")}`);

  const charge = chargeAttempts(dirname(stripPath), record.id);
  const { cost } = charge;
  const file = join(ELEMENTS, `${record.id}.json`);
  const raw = JSON.parse(readFileSync(file, "utf8"));
  raw.animation = {
    frames: attempt.frames,
    fps: 6,
    order: "cycle",
    service: attempt.service,
    model: attempt.model,
    prompt: attempt.prompt,
    seed: attempt.seed,
    params: attempt.params,
    snappedTo: attempt.snappedTo,
    offPaletteBefore: attempt.offPaletteBefore,
    cost,
    checks: { attempt: attempt.attempt, passed: attempt.gate.passed, warnings: attempt.gate.warnings },
  };
  elementRecordSchema.parse(raw);

  if (sceneFile !== undefined) editPlan(sceneFile, (plan) => chargePlan(plan, charge));
  const strip = join(ELEMENTS, `${record.id}.strip.png`);
  copyFileSync(stripPath, strip);
  writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
  charge.commit();

  return { element: record.id, strip, record: file, frames: attempt.frames, cost, ...(sceneFile !== undefined ? { plan: sceneFile } : {}) };
}

main(async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      service: { type: "string" }, frames: { type: "string" }, motion: { type: "string" }, seed: { type: "string" },
      accept: { type: "string" }, scene: { type: "string" }, abandon: { type: "boolean" },
    },
  });
  const [id, ...rest] = positionals;
  if (!id || rest.length > 0) throw new Error(USAGE);
  if (values.abandon) {
    if (values.scene === undefined) throw new Error("--abandon needs --scene");
    return fallBack(readProp(id), values.scene);
  }
  const record = readProp(id);
  if (values.accept !== undefined) return accept(record, values.accept, values.scene);
  const service = (values.service ?? "pixellab") as StripService;
  if (!SERVICES.includes(service)) throw new Error(`--service must be pixellab or retro-diffusion, got ${values.service}`);
  const frames = values.frames === undefined ? DEFAULT_STRIP_FRAMES[service] : Number(values.frames);
  if (service === "pixellab" && !isPixelLabFrames(frames)) {
    throw new Error(`--frames for pixellab must be an odd number from 5 to 15, got ${values.frames}`);
  }
  if (!Number.isInteger(frames) || frames < 2 || frames > 16) throw new Error(`--frames must be an integer from 2 to 16, got ${values.frames}`);
  const seed = values.seed === undefined ? Math.floor(Math.random() * 2 ** 31) : Number(values.seed);
  if (!Number.isInteger(seed)) throw new Error(`--seed must be an integer, got ${values.seed}`);
  if (values.scene !== undefined) checkBudget(values.scene, record, service);
  const motion = values.motion ?? `${record.brief}, moving subtly in place`;
  return attempt(record, { service, frames, motion, seed });
});
