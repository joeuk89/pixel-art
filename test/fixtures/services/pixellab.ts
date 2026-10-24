import { deflateSync } from "node:zlib";
import type { FixtureReply, ServiceFixture } from "../../fixture-server.ts";

export const PIXELLAB_KEY = "fixture-pixellab-key";
export const MAX_JOBS = 8;
const JOB_MS = 150;
const GENERATIONS = 5;

type Job = { id: string; png: Buffer; doneAt: number; finished: boolean };

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

export const pixellabState = {
  images: new Map<string, Buffer>(),
  queue: [] as FixtureReply[],
  jobs: new Map<string, Job>(),
  created: 0,
  peakInFlight: 0,
  served429: 0,
  reset() {
    this.images.clear();
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
  handle(req) {
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
      pixellabState.jobs.set(id, { id, png, doneAt: now + JOB_MS, finished: false });
      pixellabState.peakInFlight = Math.max(pixellabState.peakInFlight, inFlight(now));
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
          usage: { type: "generations", generations: GENERATIONS },
          last_response: { images: [{ type: "base64", base64: job.png.toString("base64"), format: "png" }] },
        },
      };
    }
    return undefined;
  },
};
