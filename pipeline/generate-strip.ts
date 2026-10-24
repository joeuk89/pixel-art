import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { elementRecordSchema, type ElementRecord } from "../schema/index.ts";
import { main } from "./lib/cli.ts";
import { loadPalette } from "./lib/element-pixels.ts";
import { animateWithTextV3 } from "./lib/pixellab.ts";
import type { Pixels } from "./lib/quality-gate.ts";
import { SUBTLE_MOTION, subtleMotion } from "./lib/retro-diffusion.ts";
import { withFreshKey, type Retry } from "./lib/retry.ts";
import { buildStrip, gateStrip, snapToPalette, type StripGateReport } from "./lib/strip.ts";

const UPSCALE = 8;
const ELEMENTS = "library/elements";
const SCRATCH = "scratch/strips";
const SERVICES = ["pixellab", "retro-diffusion"] as const;
type StripService = (typeof SERVICES)[number];
const DEFAULT_FRAMES: Record<StripService, number> = { pixellab: 4, "retro-diffusion": 8 };
const MODELS: Record<StripService, string> = { pixellab: "animate-with-text-v3", "retro-diffusion": SUBTLE_MOTION };
const USAGE = "usage: generate-strip <elementId> [--service pixellab|retro-diffusion] [--frames n] [--motion text] [--seed n] | --accept <attempt.strip.png> [--scene scene.json]";

type Prop = Extract<ElementRecord, { kind: "prop" }>;

function readProp(id: string): Prop {
  const file = join(ELEMENTS, `${id}.json`);
  if (!existsSync(file)) throw new Error(`no Element ${id} in the Element library`);
  const record = elementRecordSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  if (record.kind !== "prop") throw new Error(`${id} is a backdrop; Frame strips are props only`);
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

// Its frame 0 only approximates the input, so the library still takes its place.
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
};

function nextAttempt(id: string): number {
  const prefix = `${id}-a`;
  const taken = readdirSync(SCRATCH)
    .map((n) => (n.startsWith(prefix) ? n.slice(prefix.length).match(/^(\d+)\.json$/)?.[1] : undefined))
    .filter((n) => n !== undefined)
    .map(Number);
  return 1 + Math.max(0, ...taken);
}

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
  await sharp(await encode(strip)).toFile(`${stem}.strip.png`);
  await sharp(await encode(strip)).resize(strip.width * UPSCALE, strip.height * UPSCALE, { kernel: "nearest" }).png().toFile(`${stem}.x8.png`);

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

main(async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      service: { type: "string" }, frames: { type: "string" }, motion: { type: "string" }, seed: { type: "string" },
      accept: { type: "string" }, scene: { type: "string" },
    },
  });
  const [id, ...rest] = positionals;
  if (!id || rest.length > 0) throw new Error(USAGE);
  const record = readProp(id);
  const service = (values.service ?? "pixellab") as StripService;
  if (!SERVICES.includes(service)) throw new Error(`--service must be pixellab or retro-diffusion, got ${values.service}`);
  const frames = values.frames === undefined ? DEFAULT_FRAMES[service] : Number(values.frames);
  if (!Number.isInteger(frames) || frames < 2 || frames > 16) throw new Error(`--frames must be an integer from 2 to 16, got ${values.frames}`);
  const seed = values.seed === undefined ? Math.floor(Math.random() * 2 ** 31) : Number(values.seed);
  if (!Number.isInteger(seed)) throw new Error(`--seed must be an integer, got ${values.seed}`);
  const motion = values.motion ?? `${record.brief}, moving subtly in place`;
  return attempt(record, { service, frames, motion, seed });
});
