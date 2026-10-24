import { setTimeout as sleep } from "node:timers/promises";
import { takeSlot } from "./job-slots.ts";
import { service } from "./services.ts";

export const MAX_JOBS = 8;
const SLOT_DIR = "scratch/pixellab-jobs";
const MAX_429_RETRIES = 20;

type Base64Png = { type: "base64"; base64: string; format: "png" };

export type PixfluxRequest = {
  description: string;
  image_size: { width: number; height: number };
  seed: number;
  no_background: boolean;
  color_image: Base64Png;
};

export type ProFlashRequest = {
  description: string;
  image_size: { width: number; height: number };
  seed: number;
  no_background: boolean;
  target_palette: { colors: string[]; name: string };
  style_image?: { image: Base64Png; size: { width: number; height: number }; usage_description: string };
  style_options?: { color_palette: boolean; outline: boolean; detail: boolean; shading: boolean };
};

export type ProRequest = ProFlashRequest;

export class PixelLabError extends Error {
  status: number;
  detail: string;
  constructor(what: string, status: number, detail: string) {
    super(`${what}: HTTP ${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
  }

  get styleImageTooLarge(): boolean {
    return this.status === 422 && /style image must fit/i.test(this.detail);
  }
}

export const STYLE_OPTIONS = { color_palette: true, outline: true, detail: true, shading: true };
export const STYLE_USAGE = "style reference only: copy its outline, shading and level of detail, not its subject";

export type ProFlashResult = { png: Buffer; generations: number };

const pollMs = () => Number(process.env.PIXELLAB_POLL_MS ?? 3000);

async function detail(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text);
    return typeof body.detail === "string" ? body.detail : text;
  } catch {
    return text;
  }
}

function images(o: unknown, found: string[] = []): string[] {
  if (!o || typeof o !== "object") return found;
  const rec = o as Record<string, unknown>;
  if (typeof rec.base64 === "string") found.push(rec.base64);
  else for (const v of Object.values(rec)) images(v, found);
  return found;
}

export type AnimateRequest = {
  first_frame: { type: "base64"; base64: string; format: "png" };
  action: string;
  frame_count: number;
  seed: number;
  no_background: boolean;
};

export type JobResult = { pngs: Buffer[]; generations: number };

async function job(path: string, body: unknown): Promise<JobResult> {
  const { baseUrl, key } = service("pixellab");
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
  const slot = await takeSlot(SLOT_DIR, MAX_JOBS, pollMs());
  try {
    return await runJob(baseUrl, headers, path, body);
  } finally {
    slot.release();
  }
}

export async function createImageProFlash(body: ProFlashRequest): Promise<ProFlashResult> {
  const { pngs, generations } = await job("create-image-pro-flash", body);
  return { png: pngs[0], generations };
}

export async function generateImageV2(body: ProRequest): Promise<ProFlashResult> {
  const { pngs, generations } = await job("generate-image-v2", body);
  return { png: pngs[0], generations };
}

export async function createImagePixflux(body: PixfluxRequest): Promise<ProFlashResult> {
  const { pngs, generations } = await job("create-image-pixflux", body);
  return { png: pngs[0], generations };
}

// The reply holds frame_count + 1 images with the sent still first.
export async function animateWithTextV3(body: AnimateRequest): Promise<JobResult> {
  return job("animate-with-text-v3", body);
}

type Submitted = { background_job_id?: string; usage?: { generations?: number } };

// PixelLab answers 429 uncharged when jobs from elsewhere fill its cap, so waiting and resending is safe.
async function submit(baseUrl: string, headers: Record<string, string>, path: string, body: unknown): Promise<Submitted> {
  for (let tries = 0; ; tries++) {
    const res = await fetch(`${baseUrl}/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (res.ok) return (await res.json()) as Submitted;
    const why = await detail(res);
    if (res.status !== 429 || tries >= MAX_429_RETRIES) throw new PixelLabError(`PixelLab ${path}`, res.status, why);
    await sleep(pollMs());
  }
}

function finished(what: string, response: unknown, generations: number | undefined): JobResult {
  const found = images(response);
  if (found.length === 0) throw new Error(`${what} completed with no image`);
  return { pngs: found.map((b) => Buffer.from(b, "base64")), generations: generations ?? 0 };
}

// Some endpoints answer with the image at once instead of a background job.
async function runJob(baseUrl: string, headers: Record<string, string>, path: string, body: unknown): Promise<JobResult> {
  const submitted = await submit(baseUrl, headers, path, body);
  const job = submitted.background_job_id;
  if (job === undefined) return finished(`PixelLab ${path}`, submitted, submitted.usage?.generations);
  for (;;) {
    await sleep(pollMs());
    const poll = await fetch(`${baseUrl}/background-jobs/${job}`, { headers });
    if (!poll.ok) throw new PixelLabError(`PixelLab background job ${job}`, poll.status, await detail(poll));
    const status = (await poll.json()) as { status: string; usage?: { generations?: number }; last_response?: unknown };
    if (status.status === "failed") throw new Error(`PixelLab background job ${job} failed: ${JSON.stringify(status).slice(0, 300)}`);
    if (status.status !== "completed") continue;
    return finished(`PixelLab background job ${job}`, status.last_response, status.usage?.generations);
  }
}
