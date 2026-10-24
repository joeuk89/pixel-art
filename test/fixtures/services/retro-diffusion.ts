import sharp from "sharp";
import type { FixtureReply, ServiceFixture } from "../../fixture-server.ts";
import { breathingRgba, decodePng, OFF_PALETTE_ACTION, offPaletteRgba } from "./pixellab.ts";

export const RETRO_DIFFUSION_KEY = "fixture-retro-diffusion-key";
export const SUBTLE_MOTION = "rd_advanced_animation__subtle_motion";
export const COST_USD = 0.25;

export const INFERENCE_FAILED: FixtureReply = {
  status: 502,
  json: { status_code: 502, code: "inference_failed", message: "Unable to run inference." },
};

type Task = { gif?: Buffer; failed: boolean };

export const retroDiffusionState = {
  submitQueue: [] as FixtureReply[],
  failTasks: 0,
  submits: [] as { idempotencyKey: string | undefined; body: any }[],
  tasks: new Map<string, Task>(),
  reset() {
    this.submitQueue.length = 0;
    this.failTasks = 0;
    this.submits.length = 0;
    this.tasks.clear();
  },
};

async function gifOf(inputImage: string, frames: number, prompt: string): Promise<Buffer> {
  const still = await decodePng(Buffer.from(inputImage, "base64"));
  const stacked = Buffer.concat((prompt === OFF_PALETTE_ACTION ? offPaletteRgba : breathingRgba)(still, frames));
  return sharp(stacked, { raw: { width: still.width, height: still.height * frames, channels: 4, pageHeight: still.height } }).gif({ dither: 0 }).toBuffer();
}

export const retroDiffusion: ServiceFixture = {
  name: "retro-diffusion",
  env: (base) => ({ RETRO_DIFFUSION_BASE_URL: `${base}/v2`, RETRO_DIFFUSION_API_KEY: RETRO_DIFFUSION_KEY, RETRO_DIFFUSION_POLL_MS: "20" }),
  async handle(req) {
    if (req.headers["x-rd-token"] !== RETRO_DIFFUSION_KEY) return { status: 401, json: { detail: "Invalid token" } };
    if (req.method === "POST" && req.path === "/v2/inferences") {
      const body = JSON.parse(req.body.toString("utf8"));
      retroDiffusionState.submits.push({ idempotencyKey: req.headers["idempotency-key"] as string | undefined, body });
      const queued = retroDiffusionState.submitQueue.shift();
      if (queued) return queued;
      if (body.prompt_style !== SUBTLE_MOTION) return { status: 400, json: { detail: `unknown prompt_style ${body.prompt_style}` } };
      const id = `task-${retroDiffusionState.submits.length}`;
      if (retroDiffusionState.failTasks > 0) {
        retroDiffusionState.failTasks--;
        retroDiffusionState.tasks.set(id, { failed: true });
      } else {
        retroDiffusionState.tasks.set(id, { gif: await gifOf(body.input_image, body.frames_duration, body.prompt), failed: false });
      }
      return { json: { task_id: id, status: "pending" } };
    }
    const poll = req.path.match(/^\/v2\/inferences\/tasks\/([^/]+)$/);
    if (req.method === "GET" && poll) {
      const task = retroDiffusionState.tasks.get(poll[1]);
      if (!task) return { status: 404, json: { detail: "Task not found" } };
      if (task.failed) return { json: { task_id: poll[1], status: "failed", error: INFERENCE_FAILED.json } };
      return {
        json: {
          task_id: poll[1],
          status: "succeeded",
          result: { base64_images: [task.gif!.toString("base64")], balance_cost: COST_USD, remaining_balance: 7.5 },
        },
      };
    }
    return undefined;
  },
};
