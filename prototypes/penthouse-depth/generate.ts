// PROTOTYPE. Generates the stand-in Elements for the depth prototype: a sharp near armchair at 96x96 (Pro Flash,
// styled on the v1 armchair; 96x96 is a native size, the beta 88x96 custom size hung) and room shells on Bitforge (styled on the v1 Poster), guided by the prototype's own perspective geometry as an
// init image. Outputs land in out/raw; re-runs skip what exists. Run: node generate.ts [job-id]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

process.loadEnvFile("../../.env");
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${process.env.PIXELLAB_API_KEY!}` };
const PALETTE = JSON.parse(readFileSync("../../library/palettes/cosy-night.json", "utf8")).colours as string[];
const b64 = (file: string) => ({ type: "base64", base64: readFileSync(file).toString("base64"), format: "png" });
const ANCHOR = "../../library/elements/armchair-back-wool-throw-01.png";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SHELL = "empty dark modern penthouse living room seen from inside, one-point perspective, polished dark wood floor, dark plaster side walls with a framed painting, low ceiling with recessed spotlights, the back wall is a huge floor-to-ceiling window showing only black night";
const bitforge = (description: string, seed: number, init?: { file: string; strength: number }) => ({
  description, seed, image_size: { width: 192, height: 120 }, text_guidance_scale: 8,
  style_image: b64("../../scenes/penthouse-rain-city-night-1x66/poster.png"), style_strength: 50, color_image: b64("out/in/palette.png"),
  ...(init ? { init_image: b64(init.file), init_image_strength: init.strength } : {}),
});
const JOBS: Record<string, { path: string; body: unknown; async?: boolean }> = {
  "chair-96x96": {
    path: "create-image-pro-flash", async: true,
    body: {
      description: "modern armchair seen from behind, high rounded back, dark charcoal fabric, a cream wool throw draped over the back",
      image_size: { width: 96, height: 96 }, seed: 2038969678, no_background: true, target_palette: { colors: PALETTE, name: "cosy-night" },
      style_image: { image: b64(ANCHOR), size: { width: 44, height: 48 }, usage_description: "style reference only: copy its outline, shading and level of detail, not its subject" },
      style_options: { color_palette: true, outline: true, detail: true, shading: true },
    },
  },
  "shell-A-init300": { path: "create-image-bitforge", body: bitforge(SHELL, 11, { file: "out/in/shell-A.png", strength: 300 }) },
  "shell-A-init600": { path: "create-image-bitforge", body: bitforge(SHELL, 11, { file: "out/in/shell-A.png", strength: 600 }) },
  "shell-A-init450": { path: "create-image-bitforge", body: { ...bitforge(SHELL, 11, { file: "out/in/shell-A.png", strength: 450 }), negative_description: "stars, snow, rug, furniture, people" } },
  "shell-A-text": { path: "create-image-bitforge", body: bitforge(SHELL, 11) },
  "near-C-init400": {
    path: "create-image-bitforge",
    body: bitforge("dark hallway wall seen straight on, an open doorway in the middle showing only black, light wooden door frame, a small framed painting on the left of the wall, a wooden coat stand on the right, cosy and lived in", 12, { file: "out/in/near-C.png", strength: 400 }),
  },
};

const T = () => AbortSignal.timeout(240_000);
async function balance() { return (await fetch("https://api.pixellab.ai/v2/balance", { headers, signal: T() })).json(); }
function firstImage(o: any): string | undefined {
  if (!o || typeof o !== "object") return;
  if (typeof o.base64 === "string" && o.base64.length > 100) return o.base64.replace(/^data:image\/png;base64,/, "");
  for (const v of Object.values(o)) { const f = firstImage(v); if (f) return f; }
}
async function run(id: string) {
  const file = `out/raw/${id}.png`;
  if (existsSync(file)) return;
  const { path, body, async } = JOBS[id];
  console.log(`start ${id}`);
  const r = await fetch(`https://api.pixellab.ai/v2/${path}`, { method: "POST", headers, body: JSON.stringify(body), signal: T() });
  let j: any = await r.json();
  if (!r.ok) { console.log(`FAIL ${id} ${r.status} ${JSON.stringify(j).slice(0, 300)}`); return; }
  const job = j.background_job_id;
  if (async) for (let n = 0; ; n++) {
    if (n > 120) { console.log(`FAIL ${id} still pending after 6 min, job ${job}`); return; }
    await sleep(3000);
    j = await (await fetch(`https://api.pixellab.ai/v2/background-jobs/${job}`, { headers, signal: T() })).json();
    if (j.status === "completed") { j = j.last_response; break; }
    if (j.status === "failed") { console.log(`FAIL ${id} ${JSON.stringify(j).slice(0, 300)}`); return; }
  }
  writeFileSync(file, Buffer.from(firstImage(j)!, "base64"));
  console.log(`ok ${id}`, JSON.stringify(j.usage ?? ""));
}

mkdirSync("out/raw", { recursive: true });
const only = process.argv[2];
console.log("balance before", JSON.stringify(await balance()));
await Promise.all(Object.keys(JOBS).filter((k) => !only || k === only).map((id) => run(id).catch((e) => console.log(`FAIL ${id} ${e.message}`))));
console.log("balance after", JSON.stringify(await balance()));
