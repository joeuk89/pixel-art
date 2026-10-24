import { setTimeout as sleep } from "node:timers/promises";
import sharp from "sharp";
import type { Pixels } from "./quality-gate.ts";
import { service } from "./services.ts";

export const SUBTLE_MOTION = "rd_advanced_animation__subtle_motion";
export const RD_PLUS_ENVIRONMENT = "rd_plus__environment";

export type RdPlusRequest = { prompt: string; width: number; height: number; seed: number; input_palette: string };

export type SubtleMotionRequest = {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  frames_duration: number;
  input_image: string;
};

export class RetroDiffusionError extends Error {
  status: number;
  constructor(what: string, status: number, detail: string) {
    super(`${what}: HTTP ${status}: ${detail}`);
    this.status = status;
  }
}

const pollMs = () => Number(process.env.RETRO_DIFFUSION_POLL_MS ?? 4000);

async function decodeGif(gif: Buffer): Promise<Pixels[]> {
  const image = sharp(gif, { animated: true });
  const { width, height, pages, pageHeight } = await image.metadata();
  const frameHeight = pageHeight ?? height!;
  const data = new Uint8Array(await image.ensureAlpha().raw().toBuffer());
  const size = width! * frameHeight * 4;
  return Array.from({ length: pages ?? 1 }, (_, k) => ({ width: width!, height: frameHeight, data: data.slice(k * size, (k + 1) * size) }));
}

async function inference(body: Record<string, unknown>, idempotencyKey: string): Promise<{ image: Buffer; costUsd: number }> {
  const { baseUrl, key } = service("retro-diffusion");
  const res = await fetch(`${baseUrl}/inferences`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-RD-Token": key, "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ ...body, num_images: 1 }),
  });
  if (!res.ok) throw new RetroDiffusionError("Retro Diffusion inference", res.status, await res.text());
  const { task_id: task } = (await res.json()) as { task_id: string };
  for (;;) {
    await sleep(pollMs());
    const poll = await fetch(`${baseUrl}/inferences/tasks/${task}`, { headers: { "X-RD-Token": key } });
    if (!poll.ok) throw new RetroDiffusionError(`Retro Diffusion task ${task}`, poll.status, await poll.text());
    const status = (await poll.json()) as {
      status: string;
      error?: unknown;
      result?: { base64_images?: string[]; output_urls?: string[]; balance_cost?: number };
    };
    if (status.status === "failed") throw new Error(`Retro Diffusion task ${task} failed: ${JSON.stringify(status.error)}`);
    if (status.status !== "succeeded") continue;
    const result = status.result ?? {};
    const image = result.base64_images?.length
      ? Buffer.from(result.base64_images[0], "base64")
      : result.output_urls?.length
        ? Buffer.from(await (await fetch(result.output_urls[0])).arrayBuffer())
        : undefined;
    if (!image) throw new Error(`Retro Diffusion task ${task} succeeded with no image`);
    return { image, costUsd: result.balance_cost ?? 0 };
  }
}

export async function subtleMotion(body: SubtleMotionRequest, idempotencyKey: string): Promise<{ frames: Pixels[]; costUsd: number }> {
  const { image, costUsd } = await inference({ ...body, prompt_style: SUBTLE_MOTION }, idempotencyKey);
  return { frames: await decodeGif(image), costUsd };
}

export async function rdPlusEnvironment(body: RdPlusRequest, idempotencyKey: string): Promise<{ png: Buffer; costUsd: number }> {
  const { image, costUsd } = await inference({ ...body, prompt_style: RD_PLUS_ENVIRONMENT }, idempotencyKey);
  return { png: image, costUsd };
}
