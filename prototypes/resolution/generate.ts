// PROTOTYPE. The paid calls for the resolution prototype: the penthouse's props and Features regenerated at their v2
// sizes for 384x240, and the window Backdrop on four services. Every prop is sized by the Scale at its foot depth
// (see sizes in README.md). Outputs land in out/raw with a ledger in out/ledger.json; re-runs skip what exists.
// Run from the repo root: node --env-file=.env prototypes/resolution/generate.ts [job-id]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import sharp from "sharp";
import { STYLE_OPTIONS, STYLE_USAGE } from "../../pipeline/lib/pixellab.ts";

const OUT = join(import.meta.dirname, "out/raw");
const LEDGER = join(import.meta.dirname, "out/ledger.json");
const palette = JSON.parse(readFileSync("library/palettes/cosy-night.json", "utf8"));
const b64 = (buf: Buffer) => ({ type: "base64" as const, base64: buf.toString("base64"), format: "png" as const });
const anchorPng = readFileSync("library/elements/armchair-back-wool-throw-01.png");
const anchor = { image: b64(anchorPng), size: { width: 44, height: 48 }, usage_description: STYLE_USAGE };
const target_palette = { colors: palette.colours, name: palette.name };
const rgb = (h: string) => [1, 3, 5].map((o) => parseInt(h.slice(o, o + 2), 16));
const palettePng = await sharp(Buffer.from(palette.colours.flatMap(rgb)), { raw: { width: 16, height: 1, channels: 3 } }).png().toBuffer();

const PL = process.env.PIXELLAB_BASE_URL!.replace(/\/+$/, ""), RD = process.env.RETRO_DIFFUSION_BASE_URL!.replace(/\/+$/, "");
const plHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${process.env.PIXELLAB_API_KEY}` };

function firstImage(o: unknown): string | undefined {
  if (!o || typeof o !== "object") return;
  const r = o as Record<string, unknown>;
  if (typeof r.base64 === "string") return r.base64;
  for (const v of Object.values(r)) { const f = firstImage(v); if (f) return f; }
}

async function pixellab(path: string, body: unknown): Promise<{ png: Buffer; cost: string }> {
  let res: Response;
  for (let tries = 0; ; tries++) {
    res = await fetch(`${PL}/${path}`, { method: "POST", headers: plHeaders, body: JSON.stringify(body) });
    if (res.status !== 429 || tries > 20) break;
    await sleep(3000);
  }
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const first = (await res.json()) as { background_job_id?: string; usage?: unknown };
  if (!first.background_job_id) return { png: Buffer.from(firstImage(first)!, "base64"), cost: JSON.stringify(first.usage) };
  for (;;) {
    await sleep(3000);
    const poll = await fetch(`${PL}/background-jobs/${first.background_job_id}`, { headers: plHeaders });
    const s = (await poll.json()) as { status: string; usage?: unknown; last_response?: unknown };
    if (s.status === "failed") throw new Error(`${path} failed: ${JSON.stringify(s).slice(0, 400)}`);
    if (s.status === "completed") return { png: Buffer.from(firstImage(s.last_response)!, "base64"), cost: JSON.stringify(s.usage) };
  }
}

async function retroDiffusion(body: Record<string, unknown>): Promise<{ png: Buffer; cost: string }> {
  const headers = { "Content-Type": "application/json", "X-RD-Token": process.env.RETRO_DIFFUSION_API_KEY! };
  const res = await fetch(`${RD}/inferences`, { method: "POST", headers: { ...headers, "Idempotency-Key": `resolution-${body.seed}` }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`RD: HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const { task_id } = (await res.json()) as { task_id: string };
  for (;;) {
    await sleep(4000);
    const s = (await (await fetch(`${RD}/inferences/tasks/${task_id}`, { headers })).json()) as { status: string; error?: unknown; result?: { base64_images?: string[]; output_urls?: string[]; balance_cost?: number } };
    if (s.status === "failed") throw new Error(`RD failed: ${JSON.stringify(s.error)}`);
    if (s.status !== "succeeded") continue;
    const r = s.result ?? {};
    const png = r.base64_images?.length ? Buffer.from(r.base64_images[0], "base64") : Buffer.from(await (await fetch(r.output_urls![0])).arrayBuffer());
    return { png, cost: `$${r.balance_cost}` };
  }
}

const proFlash = (description: string, width: number, height: number, prop: boolean, seed: number, style = true) => () =>
  pixellab("create-image-pro-flash", {
    description, seed, image_size: { width, height }, no_background: prop, target_palette,
    ...(style ? { style_image: anchor, style_options: STYLE_OPTIONS } : {}),
  });

const BACKDROP = "open night cityscape seen from high above, no window, no frame, no interior, no furniture: stormy violet and navy sky with heavy layered cloud banks, a dense city skyline far below with a variety of towers, office blocks and spires with small yellow window lights, a wide dark river winding across the bottom with tiny boat lights, rain, moody and melancholy, fills the whole canvas edge to edge";

const JOBS: Record<string, () => Promise<{ png: Buffer; cost: string }>> = {
  "armchair-384": proFlash("modern armchair seen from behind, high rounded back, dark charcoal fabric, a cream wool throw draped over the back, the armchair fills the canvas", 96, 104, true, 7212, false),
  "lamp-384": proFlash("tall slim floor lamp, brass stem, round base, cream linen drum shade, the lamp fills the canvas height", 48, 136, true, 7202),
  "table-384": proFlash("small round side table, black metal legs, dark marble top, a single crystal whisky tumbler on top", 48, 48, true, 7203),
  "painting-384": proFlash("framed modern abstract painting hanging on a wall, seen straight on, thin dark wooden frame, warm orange and deep blue shapes, the frame fills the canvas", 96, 68, true, 7204),
  "sconce-384": proFlash("small modern brass wall light, a half-cylinder shade glowing warm yellow, mounted flat on a wall, seen straight on", 16, 24, true, 7205, false),
  "rug-384": proFlash("rectangular modern wool rug seen from directly above, deep blue with a cream border and a simple geometric pattern, lying flat, fills the canvas", 216, 108, true, 7206),
  "backdrop-proflash-384": proFlash(BACKDROP, 196, 148, false, 7217),
  "backdrop-proflash-192": proFlash(BACKDROP, 100, 76, false, 7208),
  "backdrop-pro-384": () => pixellab("generate-image-v2", {
    description: BACKDROP, seed: 7219, image_size: { width: 196, height: 148 }, no_background: false, target_palette,
    style_image: anchor, style_options: { ...STYLE_OPTIONS, color_palette: false },
  }),
  "backdrop-pixflux-384": () => pixellab("create-image-pixflux", {
    description: BACKDROP, seed: 7220, image_size: { width: 196, height: 148 }, no_background: false, color_image: b64(palettePng),
  }),
  "backdrop-rdplus-384": () => retroDiffusion({
    prompt: BACKDROP, prompt_style: "rd_plus__environment", width: 196, height: 148, num_images: 1, seed: 7221,
    input_palette: palettePng.toString("base64"),
  }),
};

mkdirSync(OUT, { recursive: true });
const ledger: Record<string, string> = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : {};
const only = process.argv[2];
await Promise.all(Object.entries(JOBS).filter(([id]) => !only || id === only).map(async ([id, run]) => {
  const file = join(OUT, `${id}.png`);
  if (existsSync(file)) return;
  console.log(`start ${id}`);
  try {
    const { png, cost } = await run();
    writeFileSync(file, png);
    ledger[id] = cost;
    console.log(`ok ${id} ${cost}`);
  } catch (e) {
    console.log(`FAIL ${id}: ${(e as Error).message}`);
  }
}));
writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + "\n");
