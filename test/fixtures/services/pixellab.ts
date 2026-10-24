import { deflateSync } from "node:zlib";
import sharp from "sharp";
import type { FixtureReply, ServiceFixture } from "../../fixture-server.ts";

export const PIXELLAB_KEY = "fixture-pixellab-key";
export const MAX_JOBS = 8;
const JOB_MS = 150;
const GENERATIONS = 5;
export const ANIMATE_GENERATIONS = 1;

type Job = { id: string; pngs: Buffer[]; generations: number; doneAt: number; finished: boolean };

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function hex(colour: string): [number, number, number] {
  const n = parseInt(colour.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

// Every pixel opaque and in the Palette, so an Attempt passes the still Quality gate unless a test queues another image.
function solid(width: number, height: number, colour: string): Buffer {
  const [r, g, b] = hex(colour);
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) rgba.set([r, g, b, 255], p * 4);
  return encodePng(width, height, rgba);
}

export type Rgba = { width: number; height: number; data: Uint8Array };

export async function decodePng(png: Buffer): Promise<Rgba> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

export const MOTION_COLOURS = ["#f7d35c", "#e2883a"];

// Frame k recolours its own 3% slice of the opaque pixels, so every step moves, drift stays small and the seam is one step.
export function breathingRgba(still: Rgba, count: number): Uint8Array[] {
  const opaque: number[] = [];
  for (let p = 0; p < still.width * still.height; p++) if (still.data[p * 4 + 3] !== 0) opaque.push(p);
  const slice = Math.max(1, Math.round(opaque.length * 0.03));
  const [a, b] = MOTION_COLOURS.map(hex);
  return Array.from({ length: count }, (_, k) => {
    const data = new Uint8Array(still.data);
    if (k === 0) return data;
    for (const p of opaque.slice((k - 1) * slice, k * slice)) {
      const same = data[p * 4] === a[0] && data[p * 4 + 1] === a[1] && data[p * 4 + 2] === a[2];
      data.set(same ? b : a, p * 4);
    }
    return data;
  });
}

export const OFF_PALETTE_ACTION = "an animation whose colours drift off the Palette";

// Every opaque colour after frame 0 is nudged two steps of red away from the Palette.
export function offPaletteRgba(still: Rgba, count: number): Uint8Array[] {
  return breathingRgba(still, count).map((frame, k) => {
    if (k > 0) for (let p = 0; p < frame.length; p += 4) if (frame[p + 3] !== 0) frame[p] = frame[p] > 253 ? frame[p] - 2 : frame[p] + 2;
    return frame;
  });
}

export const pixellabState = {
  images: new Map<string, Buffer>(),
  animations: new Map<string, Buffer[]>(),
  animateQueue: [] as FixtureReply[],
  animateRequests: [] as any[],
  queue: [] as FixtureReply[],
  jobs: new Map<string, Job>(),
  created: 0,
  peakInFlight: 0,
  served429: 0,
  reset() {
    this.images.clear();
    this.animations.clear();
    this.animateQueue.length = 0;
    this.animateRequests.length = 0;
    this.queue.length = 0;
    this.jobs.clear();
    this.created = 0;
    this.peakInFlight = 0;
    this.served429 = 0;
  },
};

function inFlight(now: number): number {
  let n = 0;
  for (const job of pixellabState.jobs.values()) {
    if (!job.finished && job.doneAt <= now) job.finished = true;
    if (!job.finished) n++;
  }
  return n;
}

export const pixellab: ServiceFixture = {
  name: "pixellab",
  env: (base) => ({ PIXELLAB_BASE_URL: `${base}/v2`, PIXELLAB_API_KEY: PIXELLAB_KEY, PIXELLAB_POLL_MS: "20" }),
  async handle(req) {
    if (req.headers.authorization !== `Bearer ${PIXELLAB_KEY}`) return { status: 401, json: { detail: "Invalid API key" } };
    const now = Date.now();
    if (req.method === "POST" && req.path === "/v2/create-image-pro-flash") {
      const queued = pixellabState.queue.shift();
      if (queued) {
        if (queued.status === 429) pixellabState.served429++;
        return queued;
      }
      if (inFlight(now) >= MAX_JOBS) {
        pixellabState.served429++;
        return { status: 429, json: { detail: `Maximum ${MAX_JOBS} concurrent background jobs allowed (Tier 1)` } };
      }
      const body = JSON.parse(req.body.toString("utf8"));
      const { width, height } = body.image_size;
      const style = body.style_image?.size;
      if (style && (style.width > width || style.height > height)) {
        return {
          status: 422,
          json: { detail: "1 validation error for RequestGenerateImageProFlash\n  Value error, Style image must fit the native canvas. Crop the reference or choose a larger supported canvas." },
        };
      }
      const png = pixellabState.images.get(body.description) ?? solid(width, height, body.target_palette.colors[3]);
      const id = `job-${++pixellabState.created}`;
      pixellabState.jobs.set(id, { id, pngs: [png], generations: GENERATIONS, doneAt: now + JOB_MS, finished: false });
      pixellabState.peakInFlight = Math.max(pixellabState.peakInFlight, inFlight(now));
      return { json: { background_job_id: id, status: "processing" } };
    }
    if (req.method === "POST" && req.path === "/v2/animate-with-text-v3") {
      const body = JSON.parse(req.body.toString("utf8"));
      pixellabState.animateRequests.push(body);
      if (!Number.isInteger(body.frame_count) || body.frame_count % 2 !== 0 || body.frame_count < 4 || body.frame_count > 16) {
        return { status: 422, json: { detail: [{ loc: ["body", "frame_count"], msg: "Number of animation frames (4-16, must be even)", type: "value_error" }] } };
      }
      const queued = pixellabState.animateQueue.shift();
      if (queued) return queued;
      const still = Buffer.from(body.first_frame.base64, "base64");
      const decoded = await decodePng(still);
      const frames = (body.action === OFF_PALETTE_ACTION ? offPaletteRgba : breathingRgba)(decoded, body.frame_count + 1);
      const pngs = pixellabState.animations.get(body.action) ?? [still, ...frames.slice(1).map((f) => encodePng(decoded.width, decoded.height, f))];
      const id = `job-${++pixellabState.created}`;
      pixellabState.jobs.set(id, { id, pngs, generations: ANIMATE_GENERATIONS, doneAt: now + JOB_MS, finished: false });
      return { json: { background_job_id: id, status: "processing" } };
    }
    const poll = req.path.match(/^\/v2\/background-jobs\/([^/]+)$/);
    if (req.method === "GET" && poll) {
      const job = pixellabState.jobs.get(poll[1]);
      if (!job) return { status: 404, json: { detail: "Background job not found" } };
      inFlight(now);
      if (!job.finished) return { json: { id: job.id, status: "processing" } };
      return {
        json: {
          id: job.id,
          status: "completed",
          usage: { type: "generations", generations: job.generations },
          last_response: { images: job.pngs.map((png) => ({ type: "base64", base64: png.toString("base64"), format: "png" })) },
        },
      };
    }
    return undefined;
  },
};
