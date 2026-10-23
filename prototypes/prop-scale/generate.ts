// PROTOTYPE. Generates every prop at its Scale-derived size under every condition on PixelLab Pro Flash, then
// animates the small cat with animate-with-text v3. Outputs land in out/raw; re-runs skip what exists.
// Run: node generate.ts [condition-id] [element-id]      node generate.ts strips
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { PALETTE, PALETTE_NAME } from "./palette.ts";
import { ALL, ANCHOR, CONDITIONS, STRIPS, type Anchor, type Condition, type Spec } from "./elements.ts";

process.loadEnvFile("../../.env");
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${process.env.PIXELLAB_API_KEY!}` };

type Rec = { kind: "image" | "strip"; condition: string; element: string; file: string; request?: unknown; usage?: unknown; ms: number; error?: string; frames?: number };
const MANIFEST = "out/manifest.json";
const manifest: Rec[] = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : [];
const save = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fileOf = (c: string, e: string) => `out/raw/${c}-${e}.png`;
const b64img = (file: string) => ({ type: "base64", base64: readFileSync(file).toString("base64"), format: "png" });

function allBase64(o: any, acc: string[] = []): string[] {
  if (!o || typeof o !== "object") return acc;
  if (typeof o.base64 === "string" && o.base64.length > 100) acc.push(o.base64);
  else for (const v of Object.values(o)) allBase64(v, acc);
  return acc;
}
async function plJob(path: string, body: unknown) {
  const r = await fetch(`https://api.pixellab.ai/v2/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`PL ${path} ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  for (;;) {
    await sleep(3000);
    const s = await (await fetch(`https://api.pixellab.ai/v2/background-jobs/${j.background_job_id}`, { headers })).json();
    if (s.status === "completed") return { images: allBase64(s.last_response), usage: s.usage ?? s.last_response?.usage };
    if (s.status === "failed") throw new Error(`PL ${path} failed ${JSON.stringify(s).slice(0, 400)}`);
  }
}

// The anchor as Pro Flash will accept it for this target: unchanged, centre-cropped to the target box, or
// nearest-downscaled to fit it (square, so the crop/shrink is the same shape as the anchor).
async function anchorFor(kind: Anchor, e: Spec) {
  const sharp = (await import("sharp")).default;
  if (kind === "asis") return { png: readFileSync(ANCHOR.file), w: ANCHOR.w, h: ANCHOR.h };
  const w = Math.min(e.w, ANCHOR.w), h = Math.min(e.h, ANCHOR.h);
  if (kind === "crop") return { png: await sharp(ANCHOR.file).extract({ left: (ANCHOR.w - w) >> 1, top: (ANCHOR.h - h) >> 1, width: w, height: h }).png().toBuffer(), w, h };
  const s = Math.min(w, h);
  return { png: await sharp(ANCHOR.file).resize(s, s, { kernel: "nearest" }).png().toBuffer(), w: s, h: s };
}
async function image(c: Condition, e: Spec) {
  const file = fileOf(c.id, e.id);
  if (existsSync(file)) return;
  const body: any = { description: e.brief, image_size: { width: e.w, height: e.h }, seed: c.seed, no_background: true, target_palette: { colors: PALETTE, name: PALETTE_NAME } };
  if (c.anchor !== "none") {
    const { png, w, h } = await anchorFor(c.anchor, e);
    body.style_image = { image: { type: "base64", base64: png.toString("base64"), format: "png" }, size: { width: w, height: h }, usage_description: "style reference only: copy its outline, shading and level of detail, not its subject" };
    body.style_options = { color_palette: true, outline: true, detail: true, shading: true };
  }
  const t0 = Date.now();
  try {
    const { images, usage } = await plJob("create-image-pro-flash", body);
    writeFileSync(file, Buffer.from(images[0], "base64"));
    const { style_image, ...request } = body;
    manifest.push({ kind: "image", condition: c.id, element: e.id, file, request: { ...request, style_image: c.anchor === "none" ? undefined : `${ANCHOR.id}:${c.anchor}` }, usage, ms: Date.now() - t0 });
    console.log(`ok    ${file} ${Date.now() - t0}ms`, JSON.stringify(usage ?? ""));
  } catch (err: any) {
    manifest.push({ kind: "image", condition: c.id, element: e.id, file, ms: Date.now() - t0, error: err.message });
    console.log(`FAIL  ${file}: ${err.message}`);
  }
  save();
}

async function strip(s: (typeof STRIPS)[number]) {
  const still = fileOf(s.condition, s.id);
  const file = `out/raw/strip-${s.condition}-${s.id}.png`;
  if (existsSync(file) || !existsSync(still)) return;
  const e = ALL.find((x) => x.id === s.id)!;
  const body = { first_frame: b64img(still), action: s.action, frame_count: 4, seed: 1123, no_background: true };
  const t0 = Date.now();
  try {
    const { images, usage } = await plJob("animate-with-text-v3", body);
    const sharp = (await import("sharp")).default;
    const frames = images.map((b) => Buffer.from(b, "base64"));
    await sharp({ create: { width: e.w * frames.length, height: e.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(frames.map((input, i) => ({ input, left: i * e.w, top: 0 }))).png().toFile(file);
    manifest.push({ kind: "strip", condition: s.condition, element: s.id, file, request: { ...body, first_frame: still }, usage, ms: Date.now() - t0, frames: frames.length });
    console.log(`ok    ${file} ${frames.length} frames ${Date.now() - t0}ms`, JSON.stringify(usage ?? ""));
  } catch (err: any) {
    manifest.push({ kind: "strip", condition: s.condition, element: s.id, file, ms: Date.now() - t0, error: err.message });
    console.log(`FAIL  ${file}: ${err.message}`);
  }
  save();
}

mkdirSync("out/raw", { recursive: true });
const [arg1, arg2] = process.argv.slice(2);
if (arg1 === "strips") {
  for (const s of STRIPS) await strip(s);
} else {
  // Tier 1 caps in-flight jobs at 8: run 4 lanes.
  const jobs: [Condition, Spec][] = [];
  for (const c of CONDITIONS) if (!arg1 || c.id === arg1) for (const e of ALL) if ((!arg2 || e.id === arg2) && (!c.only || c.only(e))) jobs.push([c, e]);
  const lanes = [0, 1, 2, 3].map((k) => jobs.filter((_, i) => i % 4 === k));
  await Promise.all(lanes.map(async (lane) => { for (const [c, e] of lane) await image(c, e); }));
  if (!arg1) for (const s of STRIPS) await strip(s);
}
console.log("done");
