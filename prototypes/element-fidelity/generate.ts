// PROTOTYPE. Generates every Element on every shortlisted service and writes raw PNGs to out/raw.
// Run: node generate.ts            (skips outputs that already exist, so re-runs cost nothing)
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { PALETTE, PALETTE_NAME } from "./palette.ts";
import { ELEMENTS, TIERS, sizeAt, type ElementSpec, type Tier } from "./elements.ts";

process.loadEnvFile("../../.env");
const RD_KEY = process.env.RETRO_DIFFUSION_API_KEY!;
const PL_KEY = process.env.PIXELLAB_API_KEY!;
const OA_KEY = process.env.OPENAI_API_KEY!;
const SEED = 1123;

type Job = { service: string; model: string; element: ElementSpec; tier: Tier };
type Record = Job & { element: string; width: number; height: number; file: string; seed: number; cost_usd?: number; usage?: unknown; ms: number; error?: string };

const MANIFEST = "out/manifest.json";
const manifest: Record[] = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : [];
const save = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function palettePngBase64() {
  const px = Buffer.alloc(PALETTE.length * 3);
  PALETTE.forEach((hex, i) => { const n = parseInt(hex.slice(1), 16); px[i * 3] = n >> 16; px[i * 3 + 1] = (n >> 8) & 255; px[i * 3 + 2] = n & 255; });
  const png = await sharp(px, { raw: { width: PALETTE.length, height: 1, channels: 3 } }).png().toBuffer();
  writeFileSync("out/palette.png", png);
  return png.toString("base64");
}

// ---- Retro Diffusion ---------------------------------------------------------
async function rd(job: Job, paletteB64: string) {
  const { width, height } = sizeAt(job.element, job.tier);
  const body = {
    prompt: job.element.prompt, prompt_style: job.model, width, height, num_images: 1, seed: SEED,
    input_palette: paletteB64, remove_bg: job.element.transparent, upscale_output_factor: 1,
  };
  const r = await fetch("https://api.retrodiffusion.ai/v2/inferences", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-RD-Token": RD_KEY, "Idempotency-Key": `proto11-${job.model}-${job.element.id}-${job.tier}-${SEED}` },
    body: JSON.stringify(body),
  });
  const acc = await r.json();
  if (!r.ok) throw new Error(`RD ${r.status} ${JSON.stringify(acc)}`);
  for (;;) {
    await sleep(2000);
    const t = await (await fetch(`https://api.retrodiffusion.ai/v2/inferences/tasks/${acc.task_id}`, { headers: { "X-RD-Token": RD_KEY } })).json();
    if (t.status === "succeeded") {
      const res = t.result;
      let png: Buffer;
      if (res.base64_images?.length) png = Buffer.from(res.base64_images[0], "base64");
      else png = Buffer.from(await (await fetch(res.output_urls[0])).arrayBuffer());
      return { png, cost_usd: res.balance_cost as number, usage: { remaining_balance: res.remaining_balance } };
    }
    if (t.status === "failed") throw new Error(`RD failed ${JSON.stringify(t.error)}`);
  }
}

// ---- PixelLab ---------------------------------------------------------------
const plHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${PL_KEY}` };
function findBase64(o: any): string | undefined {
  if (!o || typeof o !== "object") return;
  if (typeof o.base64 === "string" && o.base64.length > 100) return o.base64;
  for (const v of Object.values(o)) { const f = findBase64(v); if (f) return f; }
}
async function pixflux(job: Job) {
  const { width, height } = sizeAt(job.element, job.tier);
  const body = {
    description: job.element.prompt.replace(/, on a plain white background$/, ""),
    image_size: { width, height }, seed: SEED, no_background: job.element.transparent,
    outline: "selective outline", shading: "medium shading", detail: "medium detail", view: "side",
    color_image: { type: "base64", base64: readFileSync("out/palette.png").toString("base64"), format: "png" },
  };
  const r = await fetch("https://api.pixellab.ai/v2/create-image-pixflux", { method: "POST", headers: plHeaders, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`PL pixflux ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return { png: Buffer.from(j.image.base64, "base64"), usage: j.usage };
}
async function proFlash(job: Job) {
  const { width, height } = sizeAt(job.element, job.tier);
  const body = {
    description: job.element.prompt.replace(/, on a plain white background$/, ""),
    image_size: { width, height }, seed: SEED, no_background: job.element.transparent,
    target_palette: { colors: PALETTE, name: PALETTE_NAME },
  };
  const r = await fetch("https://api.pixellab.ai/v2/create-image-pro-flash", { method: "POST", headers: plHeaders, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`PL pro-flash ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  for (;;) {
    await sleep(3000);
    const s = await (await fetch(`https://api.pixellab.ai/v2/background-jobs/${j.background_job_id}`, { headers: plHeaders })).json();
    if (s.status === "completed") {
      const b64 = findBase64(s.last_response);
      if (!b64) { writeFileSync(`out/raw/pixellab-debug-${job.element.id}.json`, JSON.stringify(s, null, 2)); throw new Error("PL pro-flash: no base64 in last_response"); }
      return { png: Buffer.from(b64, "base64"), usage: s.usage ?? s.last_response?.usage };
    }
    if (s.status === "failed") throw new Error(`PL pro-flash failed ${JSON.stringify(s).slice(0, 300)}`);
  }
}

// ---- OpenAI (fallback: 1024px, downscaled later in process.ts) ---------------
async function openai(job: Job) {
  const body = {
    model: job.model, prompt: `Pixel art, 16x16-pixel blocks on a 64x64 grid, limited palette, flat colours, no anti-aliasing: ${job.element.prompt.replace(/, on a plain white background$/, "")}`,
    size: "1024x1024", quality: "low", background: "transparent", output_format: "png", n: 1,
  };
  const r = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${OA_KEY}` }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`OpenAI ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return { png: Buffer.from(j.data[0].b64_json, "base64"), usage: j.usage };
}

// ---- Plan -------------------------------------------------------------------
const jobs: Job[] = [];
for (const element of ELEMENTS) {
  for (const tier of TIERS) jobs.push({ service: "rd", model: tier === 32 ? "rd_plus__low_res" : "rd_plus__default", element, tier });
  jobs.push({ service: "rd", model: "rd_pro__default", element, tier: 64 });
  jobs.push({ service: "pixellab", model: "pixflux", element, tier: 64 });
  jobs.push({ service: "pixellab", model: "pro-flash", element, tier: 64 });
}
jobs.push({ service: "openai", model: "gpt-image-1", element: ELEMENTS.find((e) => e.id === "window")!, tier: 64 });

const only = process.argv[2]; // optional filter: service or model
const onlyEl = process.argv[3]; // optional filter: element id
mkdirSync("out/raw", { recursive: true });
const paletteB64 = await palettePngBase64();

async function run(job: Job) {
  const file = `out/raw/${job.model}-${job.element.id}-${job.tier}.png`;
  if (existsSync(file)) return;
  const t0 = Date.now();
  const base = { service: job.service, model: job.model, element: job.element.id, tier: job.tier, ...sizeAt(job.element, job.tier), file, seed: SEED };
  try {
    const res = job.service === "rd" ? await rd(job, paletteB64) : job.model === "pixflux" ? await pixflux(job) : job.model === "pro-flash" ? await proFlash(job) : await openai(job);
    writeFileSync(file, res.png);
    const meta = await sharp(res.png).metadata();
    manifest.push({ ...base, width: meta.width!, height: meta.height!, cost_usd: (res as any).cost_usd, usage: res.usage, ms: Date.now() - t0 } as Record);
    console.log(`ok    ${file} ${meta.width}x${meta.height} ${Date.now() - t0}ms`, JSON.stringify(res.usage ?? ""), (res as any).cost_usd ?? "");
  } catch (e: any) {
    manifest.push({ ...base, ms: Date.now() - t0, error: e.message } as Record);
    console.log(`FAIL  ${file}: ${e.message}`);
  }
  save();
}

// Services run in parallel, jobs within a service sequentially.
const byService = new Map<string, Job[]>();
for (const j of jobs) if ((!only || j.service === only || j.model === only) && (!onlyEl || j.element.id === onlyEl)) byService.set(j.service, [...(byService.get(j.service) ?? []), j]);
await Promise.all([...byService.values()].map(async (list) => { for (const j of list) await run(j); }));
console.log("done");
