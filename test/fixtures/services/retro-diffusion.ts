import sharp from "sharp";
import type { FixtureReply, ServiceFixture } from "../../fixture-server.ts";
import { breathingRgba, decodePng, OFF_PALETTE_ACTION, offPaletteRgba, solid } from "./pixellab.ts";

export const RETRO_DIFFUSION_KEY = "fixture-retro-diffusion-key";
export const SUBTLE_MOTION = "rd_advanced_animation__subtle_motion";
export const COST_USD = 0.25;
export const RD_PLUS_ENVIRONMENT = "rd_plus__environment";
export const RD_PLUS_COST_USD = 0.06;
const RD_PLUS_MIN_SIDE = 64;
const RD_PLUS_MAX_SIDE = 384;

export const INFERENCE_FAILED: FixtureReply = {
  status: 502,
  json: { status_code: 502, code: "inference_failed", message: "Unable to run inference." },
};

type Task = { image?: Buffer; cost: number; failed: boolean };

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
      const id = `task-${retroDiffusionState.submits.length}`;
      if (body.prompt_style === RD_PLUS_ENVIRONMENT) {
        const { width, height } = body;
        if ([width, height].some((side) => side < RD_PLUS_MIN_SIDE || side > RD_PLUS_MAX_SIDE)) {
          return { status: 400, json: { status_code: 400, code: "invalid_size", message: "width and height must be 64 to 384" } };
        }
        const palette = await decodePng(Buffer.from(body.input_palette, "base64"));
        const colour = `#${[...palette.data.subarray(12, 15)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
        retroDiffusionState.tasks.set(id, { image: solid(width, height, colour), cost: RD_PLUS_COST_USD, failed: false });
        return { json: { task_id: id, status: "pending" } };
      }
      if (body.prompt_style !== SUBTLE_MOTION) return { status: 400, json: { detail: `unknown prompt_style ${body.prompt_style}` } };
      if (retroDiffusionState.failTasks > 0) {
        retroDiffusionState.failTasks--;
        retroDiffusionState.tasks.set(id, { cost: COST_USD, failed: true });
      } else {
        retroDiffusionState.tasks.set(id, { image: await gifOf(body.input_image, body.frames_duration, body.prompt), cost: COST_USD, failed: false });
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
          result: { base64_images: [task.image!.toString("base64")], balance_cost: task.cost, remaining_balance: 7.5 },
        },
      };
    }
    return undefined;
  },
};
