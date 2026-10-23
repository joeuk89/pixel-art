// PROTOTYPE. Runs every raw Element through the research pipeline: grid snap (OpenAI only),
// binary alpha, nearest Scene-palette colour in Oklab, trim. Writes out/processed and out/stats.json,
// plus 6x nearest-neighbour previews, and a rough composite per model and tier.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { oklab, parse, differenceEuclidean } from "culori";
import { PALETTE } from "./palette.ts";

type Rec = { service: string; model: string; element: string; tier: number; file: string; error?: string; cost_usd?: number; usage?: any; ms: number };
const manifest: Rec[] = JSON.parse(readFileSync("out/manifest.json", "utf8"));
mkdirSync("out/processed", { recursive: true });
mkdirSync("out/preview", { recursive: true });

const lab = PALETTE.map((h) => oklab(parse(h)!)!);
const rgb = PALETTE.map((h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
const dist = differenceEuclidean("oklab");
const nearestCache = new Map<number, { idx: number; d: number }>();
function nearest(r: number, g: number, b: number) {
  const key = (r << 16) | (g << 8) | b;
  let hit = nearestCache.get(key);
  if (hit) return hit;
  const c = oklab({ mode: "rgb", r: r / 255, g: g / 255, b: b / 255 })!;
  let best = 0, bd = Infinity;
  lab.forEach((p, i) => { const d = dist(c, p); if (d < bd) { bd = d; best = i; } });
  hit = { idx: best, d: bd }; nearestCache.set(key, hit); return hit;
}

// Snap a large soft image to an s x s grid: search the phase with the least within-cell variance,
// then colour each cell by the mode of its opaque pixels (5-bit buckets) and make it opaque by majority.
function snapGrid(data: Buffer, w: number, h: number, s: number) {
  const ow = Math.floor(w / s), oh = Math.floor(h / s);
  let bestOff = [0, 0], bestScore = Infinity;
  for (let oy = 0; oy < s; oy += 2) for (let ox = 0; ox < s; ox += 2) {
    let score = 0;
    for (let cy = 0; cy < oh - 1; cy++) for (let cx = 0; cx < ow - 1; cx++) {
      let sr = 0, sg = 0, sb = 0, sr2 = 0, sg2 = 0, sb2 = 0, n = 0;
      for (let y = oy + cy * s; y < oy + cy * s + s; y += 2) for (let x = ox + cx * s; x < ox + cx * s + s; x += 2) {
        const i = (y * w + x) * 4; if (data[i + 3] < 128) continue;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        sr += r; sg += g; sb += b; sr2 += r * r; sg2 += g * g; sb2 += b * b; n++;
      }
      if (n) score += (sr2 - sr * sr / n) + (sg2 - sg * sg / n) + (sb2 - sb * sb / n);
    }
    if (score < bestScore) { bestScore = score; bestOff = [ox, oy]; }
  }
  const out = Buffer.alloc(ow * oh * 4);
  for (let cy = 0; cy < oh; cy++) for (let cx = 0; cx < ow; cx++) {
    const counts = new Map<number, number>(); let opaque = 0, total = 0;
    for (let y = bestOff[1] + cy * s; y < Math.min(h, bestOff[1] + cy * s + s); y++) for (let x = bestOff[0] + cx * s; x < Math.min(w, bestOff[0] + cx * s + s); x++) {
      const i = (y * w + x) * 4; total++;
      if (data[i + 3] < 128) continue; opaque++;
      const k = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const o = (cy * ow + cx) * 4;
    if (opaque * 2 <= total) continue;
    let bk = 0, bc = -1; for (const [k, c] of counts) if (c > bc) { bc = c; bk = k; }
    out[o] = ((bk >> 10) & 31) << 3; out[o + 1] = ((bk >> 5) & 31) << 3; out[o + 2] = (bk & 31) << 3; out[o + 3] = 255;
  }
  return { data: out, w: ow, h: oh, offset: bestOff };
}

const stats: any[] = [];
for (const rec of manifest) {
  if (rec.error) { stats.push({ ...rec, ok: false }); continue; }
  let { data, info } = await sharp(rec.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let w = info.width, h = info.height, note = "";
  if (rec.service === "openai") { const s = snapGrid(data, w, h, 16); data = s.data; w = s.w; h = s.h; note = `snapped 16x at offset ${s.offset}`; }

  const before = new Set<number>(); let inPalette = 0, opaque = 0, soft = 0, sumD = 0, maxD = 0;
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    if (data[i + 3] !== 255) soft++;
    opaque++;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]; before.add(key);
    const n = nearest(data[i], data[i + 1], data[i + 2]);
    if (n.d < 1e-6) inPalette++;
    sumD += n.d; maxD = Math.max(maxD, n.d);
    out[i] = rgb[n.idx][0]; out[i + 1] = rgb[n.idx][1]; out[i + 2] = rgb[n.idx][2]; out[i + 3] = 255;
  }
  // Halo: opaque edge pixels (touching transparency) whose source colour is near white, a sign of a leftover matte.
  let edge = 0, halo = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (data[i + 3] < 128) continue;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X < 0 || Y < 0 || X >= w || Y >= h ? false : data[(Y * w + X) * 4 + 3] < 128; });
    if (!nb) continue; edge++;
    if (data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 225) halo++;
  }
  const after = new Set<number>(); for (let i = 0; i < out.length; i += 4) if (out[i + 3]) after.add((out[i] << 16) | (out[i + 1] << 8) | out[i + 2]);

  const base = `${rec.model}-${rec.element}-${rec.tier}`;
  const trimmed = await sharp(out, { raw: { width: w, height: h, channels: 4 } }).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0, lineArt: true }).png().toBuffer({ resolveWithObject: true });
  writeFileSync(`out/processed/${base}.png`, trimmed.data);
  await sharp(trimmed.data).resize(trimmed.info.width * 6, trimmed.info.height * 6, { kernel: "nearest" }).png().toFile(`out/preview/${base}-processed.png`);
  const rawPrev = rec.service === "openai" ? sharp(data, { raw: { width: w, height: h, channels: 4 } }) : sharp(rec.file);
  await rawPrev.resize(w * 6, h * 6, { kernel: "nearest" }).png().toFile(`out/preview/${base}-raw.png`);
  stats.push({ ...rec, ok: true, note, width: w, height: h, trimmed: `${trimmed.info.width}x${trimmed.info.height}`, opaquePct: Math.round(100 * opaque / (w * h)), softAlpha: soft, coloursBefore: before.size, inPalettePct: Math.round(100 * inPalette / Math.max(1, opaque)), meanOklabDist: +(sumD / Math.max(1, opaque)).toFixed(4), maxOklabDist: +maxD.toFixed(3), coloursAfter: after.size, edgePx: edge, whiteHaloPx: halo });
  console.log(base, JSON.stringify(stats.at(-1), ["trimmed", "coloursBefore", "inPalettePct", "meanOklabDist", "coloursAfter", "whiteHaloPx", "note"]));
}
writeFileSync("out/stats.json", JSON.stringify(stats, null, 2));

// ---- Rough composites: one per model and tier that has all five Elements -------------------------------
mkdirSync("out/composite", { recursive: true });
const models = new Set(stats.filter((s) => s.ok).map((s) => `${s.model}|${s.tier}`));
for (const key of models) {
  const [model, tierS] = key.split("|"); const tier = +tierS; const f = tier / 64;
  const have = (el: string) => stats.find((s) => s.ok && s.model === model && s.tier === tier && s.element === el);
  if (!["lamp", "window", "skyline", "cat", "mug"].every(have)) continue;
  const W = Math.round(192 * f), H = Math.round(120 * f), deskY = Math.round(84 * f);
  const el = async (id: string) => { const b = readFileSync(`out/processed/${model}-${id}-${tier}.png`); const m = await sharp(b).metadata(); return { input: b, w: m.width!, h: m.height! }; };
  const [lamp, window, skyline, cat, mug] = await Promise.all(["lamp", "window", "skyline", "cat", "mug"].map(el));
  const desk = await sharp({ create: { width: W, height: H - deskY, channels: 4, background: "#5e2f22" } }).composite([{ input: await sharp({ create: { width: W, height: Math.max(1, Math.round(2 * f)), channels: 4, background: "#a9552d" } }).png().toBuffer(), left: 0, top: 0 }]).png().toBuffer();
  const place = (e: { input: Buffer; w: number; h: number }, left: number, bottom: number) => ({ input: e.input, left: Math.round(left), top: Math.round(bottom - e.h) });
  const canvas = sharp({ create: { width: W, height: H, channels: 4, background: "#241c33" } }).composite([
    { input: skyline.input, left: Math.round((W - skyline.w) / 2), top: 0 },
    { input: desk, left: 0, top: deskY },
    { input: window.input, left: Math.round(W / 2 - window.w / 2), top: Math.round(6 * f) },
    place(lamp, 8 * f, deskY + 6 * f),
    place(cat, W / 2 - cat.w / 2 + 10 * f, deskY + 10 * f),
    place(mug, W - mug.w - 10 * f, deskY + 8 * f),
  ]);
  const png = await canvas.png().toBuffer();
  writeFileSync(`out/composite/${model}-${tier}.png`, png);
  await sharp(png).resize(W * Math.round(6 / f), H * Math.round(6 / f), { kernel: "nearest" }).png().toFile(`out/composite/${model}-${tier}@6x.png`);
  console.log("composite", key);
}
