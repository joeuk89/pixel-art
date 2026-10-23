// PROTOTYPE. Makes the static Elements, then every generated-frame method per prop, into out/raw.
// Run: node generate.ts [statics|rd|pl4|pl8|edits|all] [prop-id]   (skips outputs that exist, so re-runs cost nothing)
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { PALETTE, PALETTE_NAME, SIZE, PROPS, type Prop } from "./props.ts";

process.loadEnvFile("../../.env");
const RD_KEY = process.env.RETRO_DIFFUSION_API_KEY!;
const PL_KEY = process.env.PIXELLAB_API_KEY!;
const SEED = 1123;

type Rec = { prop: string; method: string; files: string[]; cost_usd?: number; usage?: unknown; ms: number; error?: string; request?: unknown };
const MANIFEST = "out/manifest.json";
const manifest: Rec[] = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : [];
const save = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const done = (prop: string, method: string) => manifest.some((r) => r.prop === prop && r.method === method && !r.error);

const plHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${PL_KEY}` };
const b64img = (file: string) => ({ type: "base64", base64: readFileSync(file).toString("base64"), format: "png" });

// Collect every base64 image in a PixelLab response, in document order.
function allBase64(o: any, acc: string[] = []): string[] {
  if (!o || typeof o !== "object") return acc;
  if (typeof o.base64 === "string" && o.base64.length > 100) acc.push(o.base64);
  else for (const v of Object.values(o)) allBase64(v, acc);
  return acc;
}
async function plJob(path: string, body: unknown) {
  const r = await fetch(`https://api.pixellab.ai/v2/${path}`, { method: "POST", headers: plHeaders, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`PL ${path} ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  for (;;) {
    await sleep(3000);
    const s = await (await fetch(`https://api.pixellab.ai/v2/background-jobs/${j.background_job_id}`, { headers: plHeaders })).json();
    if (s.status === "completed") return { images: allBase64(s.last_response), usage: s.usage ?? s.last_response?.usage };
    if (s.status === "failed") throw new Error(`PL ${path} failed ${JSON.stringify(s).slice(0, 400)}`);
  }
}

// ---- Static Elements (Pro Flash, house params from the element-fidelity prototype) ----
async function staticElement(p: Prop) {
  const body = { description: p.prompt, image_size: { width: SIZE, height: SIZE }, seed: SEED, no_background: true, target_palette: { colors: PALETTE, name: PALETTE_NAME } };
  const { images, usage } = await plJob("create-image-pro-flash", body);
  return { files: [Buffer.from(images[0], "base64")], usage };
}

// Start frame: the static trimmed and centred on a 64x64 transparent canvas, so motion has room at the edges.
async function startFrame(p: Prop) {
  const file = `out/raw/${p.id}-start.png`;
  if (existsSync(file)) return file;
  const trimmed = await sharp(`out/raw/${p.id}-static.png`).trim().toBuffer();
  const m = await sharp(trimmed).metadata();
  const scale = Math.min(1, 56 / Math.max(m.width!, m.height!));
  const inner = scale < 1 ? await sharp(trimmed).resize({ width: Math.round(m.width! * scale), kernel: "nearest" }).toBuffer() : trimmed;
  const im = await sharp(inner).metadata();
  const png = await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: inner, left: Math.floor((SIZE - im.width!) / 2), top: SIZE - 4 - im.height! }]).png().toBuffer();
  writeFileSync(file, png);
  return file;
}

// ---- Retro Diffusion subtle motion ($0.25, GIF) ----
async function rdSubtle(p: Prop, frames: number) {
  const body = { prompt: p.motion, prompt_style: "rd_advanced_animation__subtle_motion", width: SIZE, height: SIZE, num_images: 1, seed: SEED, frames_duration: frames, input_image: readFileSync(await startFrame(p)).toString("base64") };
  const r = await fetch("https://api.retrodiffusion.ai/v2/inferences", { method: "POST", headers: { "Content-Type": "application/json", "X-RD-Token": RD_KEY, "Idempotency-Key": `proto19-subtle-${p.id}-${frames}-${SEED}${process.env.RETRY ? "-r" + process.env.RETRY : ""}` }, body: JSON.stringify(body) });
  const acc = await r.json();
  if (!r.ok) throw new Error(`RD ${r.status} ${JSON.stringify(acc)}`);
  for (;;) {
    await sleep(4000);
    const t = await (await fetch(`https://api.retrodiffusion.ai/v2/inferences/tasks/${acc.task_id}`, { headers: { "X-RD-Token": RD_KEY } })).json();
    if (t.status === "succeeded") {
      const res = t.result;
      const gif = res.base64_images?.length ? Buffer.from(res.base64_images[0], "base64") : Buffer.from(await (await fetch(res.output_urls[0])).arrayBuffer());
      return { files: [gif], cost_usd: res.balance_cost as number, usage: { remaining_balance: res.remaining_balance } };
    }
    if (t.status === "failed") throw new Error(`RD failed ${JSON.stringify(t.error)}`);
  }
}

// ---- PixelLab animate-with-text v3 (subscription generations) ----
async function plAnimate(p: Prop, frameCount: number) {
  const body = { first_frame: b64img(await startFrame(p)), action: p.motion, frame_count: frameCount, seed: SEED, no_background: true };
  const { images, usage } = await plJob("animate-with-text-v3", body);
  return { files: images.map((b) => Buffer.from(b, "base64")), usage };
}

// ---- PixelLab edit-images v2: one hand-briefed variant per call ----
async function plEdits(p: Prop) {
  const start = await startFrame(p);
  const files: Buffer[] = []; const usages: unknown[] = [];
  for (const description of p.edits) {
    const body = { method: "edit_with_text", edit_images: [{ image: b64img(start), width: SIZE, height: SIZE }], image_size: { width: SIZE, height: SIZE }, description, seed: SEED, no_background: true };
    const { images, usage } = await plJob("edit-images-v2", body);
    files.push(Buffer.from(images[0], "base64")); usages.push(usage);
  }
  return { files, usage: usages };
}

// ---- Plan ----
const METHODS: Record<string, { run: (p: Prop) => Promise<{ files: Buffer[]; cost_usd?: number; usage?: unknown }>; ext: string }> = {
  statics: { run: staticElement, ext: "png" },
  rd8: { run: (p) => rdSubtle(p, 8), ext: "gif" },
  rd12: { run: (p) => rdSubtle(p, 12), ext: "gif" },
  pl4: { run: (p) => plAnimate(p, 4), ext: "png" },
  pl8: { run: (p) => plAnimate(p, 8), ext: "png" },
  edits: { run: plEdits, ext: "png" },
};
const which = process.argv[2] ?? "all";
const onlyProp = process.argv[3];
const steps = which === "all" ? ["statics", "rd8", "pl4", "pl8", "edits"] : [which];
mkdirSync("out/raw", { recursive: true });

async function run(p: Prop, method: string) {
  if (method === "statics" && (!p.prompt || existsSync(`out/raw/${p.id}-static.png`))) return;
  if (method !== "statics" && done(p.id, method)) return;
  const t0 = Date.now();
  try {
    const res = await METHODS[method].run(p);
    const files = res.files.map((buf, i) => { const f = method === "statics" ? `out/raw/${p.id}-static.png` : `out/raw/${p.id}-${method}${res.files.length > 1 ? `-${String(i).padStart(2, "0")}` : ""}.${METHODS[method].ext}`; writeFileSync(f, buf); return f; });
    manifest.push({ prop: p.id, method, files, cost_usd: res.cost_usd, usage: res.usage, ms: Date.now() - t0 });
    console.log(`ok    ${p.id} ${method} ${files.length} file(s) ${Date.now() - t0}ms`, JSON.stringify(res.usage ?? ""), res.cost_usd ?? "");
  } catch (e: any) {
    manifest.push({ prop: p.id, method, files: [], ms: Date.now() - t0, error: e.message });
    console.log(`FAIL  ${p.id} ${method}: ${e.message}`);
  }
  save();
}

const props = PROPS.filter((p) => !onlyProp || p.id === onlyProp);
if (steps.includes("statics")) for (const p of props) await run(p, "statics");
for (const p of props) await startFrame(p);
// Retro Diffusion and PixelLab run in parallel; calls within a service run one at a time.
const rdSteps = steps.filter((s) => s.startsWith("rd")), plSteps = steps.filter((s) => s !== "statics" && !s.startsWith("rd"));
await Promise.all([
  (async () => { for (const s of rdSteps) for (const p of props) await run(p, s); })(),
  ...props.map(async (p) => { for (const s of plSteps) await run(p, s); }),
]);
console.log("done");
