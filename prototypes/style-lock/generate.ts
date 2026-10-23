// PROTOTYPE. Generates every Element under every condition on PixelLab Pro Flash, into out/raw.
// Run: node generate.ts [condition-id] [element-id]   (skips outputs that exist, so re-runs cost nothing)
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { PALETTE, PALETTE_NAME } from "./palette.ts";
import { ELEMENTS, ANCHOR, CONDITIONS, type Condition, type ElementSpec } from "./elements.ts";

process.loadEnvFile("../../.env");
const PL_KEY = process.env.PIXELLAB_API_KEY!;
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${PL_KEY}` };

type Rec = { condition: string; element: string; file: string; request?: unknown; usage?: unknown; ms: number; error?: string };
const MANIFEST = "out/manifest.json";
const manifest: Rec[] = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : [];
const save = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fileOf = (c: Condition, e: ElementSpec) => `out/raw/${c.id}-${e.id}.png`;

function findBase64(o: any): string | undefined {
  if (!o || typeof o !== "object") return;
  if (typeof o.base64 === "string" && o.base64.length > 100) return o.base64;
  for (const v of Object.values(o)) { const f = findBase64(v); if (f) return f; }
}

async function proFlash(c: Condition, e: ElementSpec) {
  const body: any = {
    description: e.brief, image_size: { width: e.w, height: e.h }, seed: c.seed, no_background: e.transparent,
    target_palette: { colors: PALETTE, name: PALETTE_NAME },
  };
  if (c.style) {
    const anchor = fileOf(CONDITIONS.find((x) => x.id === c.style)!, ANCHOR);
    body.style_image = { image: { type: "base64", base64: readFileSync(anchor).toString("base64"), format: "png" }, size: { width: ANCHOR.w, height: ANCHOR.h }, usage_description: "style reference only: copy its outline, shading and level of detail, not its subject" };
    body.style_options = { color_palette: true, outline: true, detail: true, shading: true, ...c.options };
  }
  const r = await fetch("https://api.pixellab.ai/v2/create-image-pro-flash", { method: "POST", headers, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`PL pro-flash ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
  for (;;) {
    await sleep(3000);
    const s = await (await fetch(`https://api.pixellab.ai/v2/background-jobs/${j.background_job_id}`, { headers })).json();
    if (s.status === "completed") {
      const b64 = findBase64(s.last_response);
      if (!b64) throw new Error("no base64 in last_response: " + JSON.stringify(s).slice(0, 300));
      const { style_image, ...request } = body;
      return { png: Buffer.from(b64, "base64"), usage: s.usage ?? s.last_response?.usage, request: { ...request, style_image: style_image ? `${c.style}/${ANCHOR.id}` : undefined } };
    }
    if (s.status === "failed") throw new Error(`PL pro-flash failed ${JSON.stringify(s).slice(0, 400)}`);
  }
}

const onlyCond = process.argv[2], onlyEl = process.argv[3];
mkdirSync("out/raw", { recursive: true });

async function run(c: Condition, e: ElementSpec) {
  const file = fileOf(c, e);
  if (existsSync(file)) return;
  const t0 = Date.now();
  try {
    const res = await proFlash(c, e);
    writeFileSync(file, res.png);
    manifest.push({ condition: c.id, element: e.id, file, request: res.request, usage: res.usage, ms: Date.now() - t0 });
    console.log(`ok    ${file} ${Date.now() - t0}ms`, JSON.stringify(res.usage ?? ""));
  } catch (err: any) {
    manifest.push({ condition: c.id, element: e.id, file, ms: Date.now() - t0, error: err.message });
    console.log(`FAIL  ${file}: ${err.message}`);
  }
  save();
}

// Anchor first (style conditions need it), then conditions in parallel, Elements within a condition two at a time.
if (!onlyCond || onlyCond === "base-s1") await run(CONDITIONS[0], ANCHOR);
await Promise.all(CONDITIONS.filter((c) => !onlyCond || c.id === onlyCond).map(async (c) => {
  const els = ELEMENTS.filter((e) => (!onlyEl || e.id === onlyEl) && (!c.only || c.only.includes(e.id)));
  const lanes = [els.filter((_, i) => i % 2 === 0), els.filter((_, i) => i % 2 === 1)];
  await Promise.all(lanes.map(async (lane) => { for (const e of lane) await run(c, e); }));
}));
console.log("done");
