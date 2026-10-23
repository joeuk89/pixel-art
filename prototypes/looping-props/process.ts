// PROTOTYPE. Decodes every generated result into 64x64 frames, measures palette drift, alpha cleanliness,
// motion per frame and the loop seam, and writes vertical strips (raw and snapped to the palette) plus out/stats.json.
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import sharp from "sharp";
import { oklab, parse, differenceEuclidean } from "culori";
import { PALETTE, SIZE, PROPS } from "./props.ts";

type Rec = { prop: string; method: string; files: string[]; cost_usd?: number; usage?: unknown; ms: number; error?: string };
const manifest: Rec[] = JSON.parse(readFileSync("out/manifest.json", "utf8"));
mkdirSync("out/strips", { recursive: true });

const lab = PALETTE.map((h) => oklab(parse(h)!)!);
const rgb = PALETTE.map((h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
const inPalette = new Set(PALETTE.map((h) => parseInt(h.slice(1), 16)));
const dist = differenceEuclidean("oklab");
const cache = new Map<number, number>();
function nearest(r: number, g: number, b: number) {
  const key = (r << 16) | (g << 8) | b;
  let hit = cache.get(key); if (hit !== undefined) return hit;
  const c = oklab({ mode: "rgb", r: r / 255, g: g / 255, b: b / 255 })!;
  let best = 0, bd = Infinity; lab.forEach((p, i) => { const d = dist(c, p); if (d < bd) { bd = d; best = i; } });
  cache.set(key, best); return best;
}

// Frames as 64x64 RGBA buffers plus per-frame delays in ms (GIF) or null.
async function frames(files: string[]): Promise<{ frames: Buffer[]; delays: number[] | null }> {
  if (files.length === 1 && files[0].endsWith(".gif")) {
    const img = sharp(files[0], { animated: true });
    const m = await img.metadata();
    const raw = await img.ensureAlpha().raw().toBuffer();
    const n = m.pages!, fh = m.pageHeight ?? m.height! / n, fw = m.width!;
    const out: Buffer[] = [];
    for (let i = 0; i < n; i++) out.push(await fit(raw.subarray(i * fw * fh * 4, (i + 1) * fw * fh * 4), fw, fh));
    return { frames: out, delays: m.delay ?? null };
  }
  const out: Buffer[] = [];
  for (const f of files) { const img = sharp(f).ensureAlpha(); const m = await img.metadata(); out.push(await fit(await img.raw().toBuffer(), m.width!, m.height!)); }
  return { frames: out, delays: null };
}
async function fit(raw: Buffer, w: number, h: number) {
  if (w === SIZE && h === SIZE) return raw;
  return sharp(raw, { raw: { width: w, height: h, channels: 4 } }).resize(SIZE, SIZE, { kernel: "nearest", fit: "fill" }).raw().toBuffer();
}

function measure(f: Buffer) {
  let opaque = 0, off = 0, soft = 0; const colours = new Set<number>();
  for (let i = 0; i < f.length; i += 4) {
    const a = f[i + 3]; if (a > 0 && a < 255) soft++; if (a < 128) continue; opaque++;
    const k = (f[i] << 16) | (f[i + 1] << 8) | f[i + 2]; colours.add(k); if (!inPalette.has(k)) off++;
  }
  return { opaque, offPalettePct: opaque ? +(100 * off / opaque).toFixed(1) : 0, softAlphaPct: +(100 * soft / (f.length / 4)).toFixed(1), colours: colours.size };
}
// Share of the canvas that differs between two frames (alpha or colour).
function diff(a: Buffer, b: Buffer) {
  let n = 0; for (let i = 0; i < a.length; i += 4) { const oa = a[i + 3] >= 128, ob = b[i + 3] >= 128; if (oa !== ob || (oa && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]))) n++; }
  return +(100 * n / (a.length / 4)).toFixed(2);
}
function snap(f: Buffer) {
  const o = Buffer.alloc(f.length);
  for (let i = 0; i < f.length; i += 4) { if (f[i + 3] < 128) continue; const c = rgb[nearest(f[i], f[i + 1], f[i + 2])]; o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2]; o[i + 3] = 255; }
  return o;
}
async function strip(fs: Buffer[], file: string) {
  await sharp(Buffer.concat(fs), { raw: { width: SIZE, height: SIZE * fs.length, channels: 4 } }).png({ palette: true }).toFile(file);
}

const stats: any[] = [];
for (const p of PROPS) {
  // The static start frame is the reference every method is judged against.
  const start = (await frames([`out/raw/${p.id}-start.png`])).frames[0];
  const startM = measure(start);
  await strip([start], `out/strips/${p.id}-start.png`);
  stats.push({ prop: p.id, method: "start", frames: 1, ...startM, files: [`out/raw/${p.id}-start.png`] });
  // One record per method: the last successful run, else the last failure.
  const byMethod = new Map<string, Rec>();
  for (const r of manifest.filter((r) => r.prop === p.id && r.method !== "statics")) if (!r.error || !byMethod.get(r.method) || byMethod.get(r.method)!.error) byMethod.set(r.method, r);
  for (const r of byMethod.values()) {
    if (r.error) { stats.push({ prop: p.id, method: r.method, error: r.error, ms: r.ms }); continue; }
    let { frames: fs, delays } = await frames(r.files);
    if (r.method === "edits") fs = [start, ...fs]; // edits are variants of the start frame; the page plays start -> edits -> start
    const per = fs.map(measure);
    const motion = fs.map((f, i) => (i === 0 ? 0 : diff(fs[i - 1], f)));
    const bytes = r.files.reduce((n, f) => n + statSync(f).size, 0);
    await strip(fs, `out/strips/${p.id}-${r.method}.png`);
    await strip(fs.map(snap), `out/strips/${p.id}-${r.method}-snapped.png`);
    stats.push({
      prop: p.id, method: r.method, frames: fs.length, delays, bytes, ms: r.ms, cost_usd: r.cost_usd, usage: r.usage, files: r.files,
      offPalettePct: +(per.reduce((s, m) => s + m.offPalettePct, 0) / per.length).toFixed(1),
      softAlphaPct: +(per.reduce((s, m) => s + m.softAlphaPct, 0) / per.length).toFixed(1),
      coloursMax: Math.max(...per.map((m) => m.colours)),
      driftFromStart: diff(start, fs[fs.length - 1]),
      motionAvg: +(motion.slice(1).reduce((s, v) => s + v, 0) / Math.max(1, motion.length - 1)).toFixed(2),
      seam: diff(fs[fs.length - 1], fs[0]),
      firstFrameVsStart: diff(start, fs[0]),
    });
  }
}
writeFileSync("out/stats.json", JSON.stringify(stats, null, 2));
console.table(stats.map(({ prop, method, frames, offPalettePct, softAlphaPct, coloursMax, driftFromStart, motionAvg, seam, firstFrameVsStart, cost_usd, ms, error }) => ({ prop, method, frames, offPalettePct, softAlphaPct, coloursMax, driftFromStart, motionAvg, seam, firstFrameVsStart, cost_usd, s: ms ? Math.round(ms / 1000) : "", error: error?.slice(0, 40) })));
