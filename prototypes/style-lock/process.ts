// PROTOTYPE. Checks every raw Element (dimensions, binary alpha, palette membership), measures style traits,
// compares conditions, and writes out/index.html with side-by-side previews, lineups and rough composites.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import sharp from "sharp";
import { PALETTE } from "./palette.ts";
import { ELEMENTS, CONDITIONS, ANCHOR } from "./elements.ts";

type Rec = { condition: string; element: string; file: string; usage?: any; ms: number; error?: string; request?: any };
const manifest: Rec[] = JSON.parse(readFileSync("out/manifest.json", "utf8"));
for (const d of ["out/preview", "out/lineup", "out/composite"]) mkdirSync(d, { recursive: true });

const rgb = PALETTE.map((h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
const luma = rgb.map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
const idxOf = new Map(rgb.map(([r, g, b], i) => [(r << 16) | (g << 8) | b, i]));

type M = { ok: boolean; why?: string; w: number; h: number; opaque: number; fill: number; colours: number; outlineShare: number; edgeLuma: number; edgeDensity: number; dither: number; lumaSd: number; hist: number[]; idx: Int16Array; trimmed: string };
async function measure(file: string, w0: number, h0: number): Promise<M> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const idx = new Int16Array(w * h).fill(-1);
  let why = "";
  if (w !== w0 || h !== h0) why = `size ${w}x${h}`;
  let offPal = 0, softA = 0, opaque = 0;
  for (let p = 0; p < w * h; p++) {
    const a = data[p * 4 + 3];
    if (a !== 0 && a !== 255) softA++;
    if (a < 128) continue;
    opaque++;
    const i = idxOf.get((data[p * 4] << 16) | (data[p * 4 + 1] << 8) | data[p * 4 + 2]);
    if (i === undefined) offPal++; else idx[p] = i;
  }
  if (softA) why += ` soft alpha ${softA}`;
  if (offPal) why += ` off-palette ${offPal}`;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -2 : idx[y * w + x]);
  let edge = 0, edgeDark = 0, edgeLumaSum = 0, busy = 0, dither = 0, lsum = 0, l2 = 0;
  const hist = new Array(PALETTE.length).fill(0);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y); if (c < 0) continue;
    hist[c]++; lsum += luma[c]; l2 += luma[c] * luma[c];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    const n = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
    if (n.some((v) => v === -1)) { edge++; edgeLumaSum += luma[c]; if (c <= 1) edgeDark++; }
    if (n.some((v) => v >= 0 && v !== c)) busy++;
    if (n[0] >= 0 && n[0] === n[1] && n[0] !== c && n[2] >= 0 && n[2] === n[3] && n[2] !== c) dither++;
  }
  const mean = lsum / opaque, sd = Math.sqrt(Math.max(0, l2 / opaque - mean * mean));
  return { ok: !why, why: why.trim() || undefined, w, h, opaque, fill: opaque / (w * h), colours: hist.filter((n) => n > 0).length,
    outlineShare: edge ? edgeDark / edge : NaN, edgeLuma: edge ? edgeLumaSum / edge : NaN, edgeDensity: busy / opaque, dither: dither / opaque, lumaSd: sd,
    hist: hist.map((n) => n / opaque), idx, trimmed: maxX < 0 ? "0x0" : `${maxX - minX + 1}x${maxY - minY + 1}` };
}

// Style vector: traits a viewer reads as "the same hand", each scaled to roughly 0..1.
const vec = (m: M) => [m.colours / 16, isNaN(m.outlineShare) ? 0 : m.outlineShare, m.edgeDensity, m.dither * 10, m.lumaSd / 80];
const dist = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
const histDist = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / 2;
const pixelSame = (a: M, b: M) => { let same = 0, n = 0; for (let p = 0; p < a.idx.length; p++) { if (a.idx[p] === -1 && b.idx[p] === -1) continue; n++; if (a.idx[p] === b.idx[p]) same++; } return n ? same / n : 1; };

const results = new Map<string, M>();
const key = (c: string, e: string) => `${c}/${e}`;
for (const r of manifest) {
  if (r.error || !existsSync(r.file)) continue;
  const e = ELEMENTS.find((x) => x.id === r.element)!;
  const m = await measure(r.file, e.w, e.h);
  results.set(key(r.condition, r.element), m);
  await sharp(r.file).resize(e.w * 4, e.h * 4, { kernel: "nearest" }).png().toFile(`out/preview/${r.condition}-${r.element}.png`);
}

// Lineups: every Element of a condition side by side at native size, then 4x.
for (const c of CONDITIONS) {
  const els = ELEMENTS.filter((e) => results.has(key(c.id, e.id)));
  if (!els.length) continue;
  const W = els.reduce((s, e) => s + e.w + 4, 4);
  let x = 4; const comps = els.map((e) => { const o = { input: `out/raw/${c.id}-${e.id}.png`, left: x, top: 4 }; x += e.w + 4; return o; });
  const png = await sharp({ create: { width: W, height: 72, channels: 4, background: PALETTE[1] } }).composite(comps).png().toBuffer();
  await sharp(png).resize(W * 4, 72 * 4, { kernel: "nearest" }).png().toFile(`out/lineup/${c.id}.png`);
}

// Rough composite per full condition at 192x120.
for (const c of CONDITIONS) {
  if (!ELEMENTS.every((e) => results.has(key(c.id, e.id)))) continue;
  const trimmed = async (id: string) => { const b = await sharp(`out/raw/${c.id}-${id}.png`).trim({ threshold: 0 }).toBuffer(); const m = await sharp(b).metadata(); return { input: b, w: m.width!, h: m.height! }; };
  const t: Record<string, { input: Buffer; w: number; h: number }> = {};
  for (const e of ELEMENTS) t[e.id] = await trimmed(e.id);
  const rect = async (w: number, h: number, bg: string) => sharp({ create: { width: w, height: h, channels: 4, background: bg } }).png().toBuffer();
  const bottom = (id: string, left: number, b: number) => ({ input: t[id].input, left, top: b - t[id].h });
  const centre = (id: string, cx: number, b: number) => bottom(id, Math.round(cx - t[id].w / 2), b);
  const png = await sharp({ create: { width: 192, height: 120, channels: 4, background: PALETTE[1] } }).composite([
    { input: `out/raw/${c.id}-skyline.png`, left: 0, top: 0 }, { input: `out/raw/${c.id}-skyline.png`, left: 128, top: 0 },
    { input: await rect(192, 28, PALETTE[2]), left: 0, top: 92 },
    centre("window", 96, 4 + t.window.h), centre("clock", 160, 6 + t.clock.h),
    bottom("bookshelf", 2, 98), centre("armchair", 160, 104), centre("plant", 56, 98),
    { input: await rect(60, 20, PALETTE[11]), left: 66, top: 80 },
    centre("lamp", 76, 81), centre("radio", 96, 81), centre("mug", 116, 81), centre("cat", 104, 104),
  ]).png().toBuffer();
  writeFileSync(`out/composite/${c.id}.png`, png);
  await sharp(png).resize(192 * 5, 120 * 5, { kernel: "nearest" }).png().toFile(`out/composite/${c.id}@5x.png`);
}

// ---- Numbers ---------------------------------------------------------------------------------------------
const f2 = (n: number) => (isNaN(n) ? "-" : n.toFixed(2));
const pct = (n: number) => (isNaN(n) ? "-" : Math.round(n * 100) + "%");
const meanSd = (xs: number[]) => { const v = xs.filter((x) => !isNaN(x)); const m = v.reduce((a, b) => a + b, 0) / v.length; return { m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) }; };
const full = CONDITIONS.filter((c) => !c.only);
const props = ELEMENTS.filter((e) => e.transparent);

// Within-condition spread: mean pairwise style distance among the ten Elements. Lower = more "one hand".
const spread = (c: string) => { const ms = ELEMENTS.map((e) => results.get(key(c, e.id))).filter(Boolean) as M[]; const ds: number[] = []; for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) ds.push(dist(vec(ms[i]), vec(ms[j]))); return meanSd(ds); };
// Distance of each Element from the anchor's style.
const anchorM = results.get(key("base-s1", ANCHOR.id))!;
const toAnchor = (c: string) => meanSd(ELEMENTS.filter((e) => e.id !== ANCHOR.id).map((e) => { const m = results.get(key(c, e.id)); return m ? dist(vec(m), vec(anchorM)) : NaN; }));
const histToAnchor = (c: string) => meanSd(props.filter((e) => e.id !== ANCHOR.id).map((e) => { const m = results.get(key(c, e.id)); return m ? histDist(m.hist, anchorM.hist) : NaN; }));

const summary: any = {};
for (const c of CONDITIONS) {
  const ms = ELEMENTS.map((e) => results.get(key(c.id, e.id))).filter(Boolean) as M[];
  if (!ms.length) continue;
  const gens = manifest.filter((r) => r.condition === c.id && !r.error).reduce((a, r) => a + (r.usage?.generations ?? 0), 0);
  const secs = manifest.filter((r) => r.condition === c.id && !r.error).reduce((a, r) => a + r.ms, 0) / ms.length / 1000;
  summary[c.id] = { n: ms.length, gens, secs, passed: ms.filter((m) => m.ok).length, colours: meanSd(ms.map((m) => m.colours)), outlineShare: meanSd(ms.map((m) => m.outlineShare)), edgeLuma: meanSd(ms.map((m) => m.edgeLuma)), edgeDensity: meanSd(ms.map((m) => m.edgeDensity)), dither: meanSd(ms.map((m) => m.dither)), lumaSd: meanSd(ms.map((m) => m.lumaSd)), spread: spread(c.id), toAnchor: toAnchor(c.id), histToAnchor: histToAnchor(c.id) };
}
// Per-Element comparisons.
const perEl = ELEMENTS.map((e) => {
  const g = (c: string) => results.get(key(c, e.id));
  const a = g("base-s1"), b = g("base-s2"), s1 = g("style-s1"), s2 = g("style-s2"), r = g("repeat-s1");
  return { element: e.id, seedEffect: a && b ? dist(vec(a), vec(b)) : NaN, styleS2vsBaseS1: a && s2 ? dist(vec(a), vec(s2)) : NaN, styleS1vsBaseS1: a && s1 ? dist(vec(a), vec(s1)) : NaN,
    pixSameRepeat: a && r ? pixelSame(a, r) : NaN, pixSameStyleS1: a && s1 ? pixelSame(a, s1) : NaN, pixSameS2: a && b ? pixelSame(a, b) : NaN, pixSameStyleS2vsS2: b && s2 ? pixelSame(b, s2) : NaN };
});
writeFileSync("out/stats.json", JSON.stringify({ summary, perEl, cells: Object.fromEntries([...results].map(([k, m]) => [k, { ...m, idx: undefined, hist: m.hist.map((v) => +v.toFixed(3)) }])) }, null, 2));

// ---- Sheet -----------------------------------------------------------------------------------------------
const esc = (s: unknown) => String(s).replace(/</g, "&lt;");
let html = `<!doctype html><meta charset="utf-8"><title>Style lock prototype</title>
<style>body{font:14px system-ui;background:#1b1b1f;color:#ddd;margin:24px}h1,h2,h3{font-weight:600}img{image-rendering:pixelated;vertical-align:top}
table{border-collapse:collapse}td,th{padding:5px 8px;border-bottom:1px solid #444;text-align:left;vertical-align:top}th{color:#aaa;font-weight:500}
.grid td{text-align:center}.grid img{background:#2a2a30;width:192px}.grid .wide img{width:384px}small{color:#999}.bad{color:#f66}.lineup img{max-width:100%;margin-bottom:8px}.comp img{margin:0 12px 12px 0}
.sw{display:inline-block;width:18px;height:18px;border:1px solid #000;margin-right:1px}</style>
<h1>Style lock across ten Pro Flash Elements (wayfinder #22)</h1>
<p>Palette ${PALETTE.map((p) => `<span class="sw" style="background:${p}"></span>`).join("")} <small>Cosy Night 16, passed as <code>target_palette</code> every time. All Elements 64x64 transparent except the 128x64 opaque skyline. Raw PNGs as PixelLab returned them, no processing.</small></p>
<p><b>Conditions.</b> <code>base-s1</code> seed 1123, no style image. <code>base-s2</code> seed 2024, no style image. <code>style-s1</code> seed 1123 with <code>base-s1/${ANCHOR.id}</code> as <code>style_image</code> (all four <code>style_options</code> on). <code>style-s2</code> seed 2024 with the same style image. <code>repeat-s1</code> the base-s1 request sent again for three Elements (determinism).</p>`;

html += `<h2>Composites (same rough layout per condition, 5x)</h2><div class="comp">`;
for (const c of full) if (existsSync(`out/composite/${c.id}@5x.png`)) html += `<div><b>${c.id}</b><br><img src="composite/${c.id}@5x.png"></div>`;
html += `</div><h2>Lineups (4x)</h2><div class="lineup">`;
for (const c of CONDITIONS) if (existsSync(`out/lineup/${c.id}.png`)) html += `<div><b>${c.id}</b><br><img src="lineup/${c.id}.png"></div>`;
html += `</div><h2>Side by side (4x)</h2><table class="grid"><tr><th></th>${CONDITIONS.map((c) => `<th>${c.id}</th>`).join("")}</tr>`;
for (const e of ELEMENTS) {
  html += `<tr class="${e.w > 64 ? "wide" : ""}"><th>${e.id}${e.id === ANCHOR.id ? "<br><small>anchor</small>" : ""}</th>`;
  for (const c of CONDITIONS) {
    const m = results.get(key(c.id, e.id)); const r = manifest.find((x) => x.condition === c.id && x.element === e.id);
    if (!m) { html += `<td><small class="bad">${r?.error ? esc(r.error.slice(0, 160)) : c.only ? "" : "missing"}</small></td>`; continue; }
    html += `<td><img src="preview/${c.id}-${e.id}.png"><br><small>${m.ok ? "" : `<span class="bad">${esc(m.why)}</span> `}${m.colours} col, trim ${m.trimmed}, outline ${pct(m.outlineShare)}, busy ${pct(m.edgeDensity)}, dither ${pct(m.dither)}, contrast ${f2(m.lumaSd)}</small></td>`;
  }
  html += `</tr>`;
}
html += `</table><h2>Per condition</h2><p><small>Mean ± sd over the Elements in the condition. <b>spread</b> = mean pairwise distance between Elements on the style vector (colours used, dark-outline share, busy-pixel share, dither share, luma contrast): lower means the set reads more as one hand. <b>to anchor</b> = mean distance of the other Elements from the anchor on that vector. <b>palette use vs anchor</b> = how differently props spend the palette compared with the anchor (0 same, 1 disjoint).</small></p>
<table><tr><th>condition</th><th>n</th><th>gens</th><th>secs</th><th>passed checks</th><th>colours</th><th>dark outline</th><th>edge luma</th><th>busy</th><th>dither</th><th>contrast</th><th>spread</th><th>to anchor</th><th>palette use vs anchor</th></tr>`;
for (const [id, s] of Object.entries<any>(summary)) html += `<tr><td>${id}</td><td>${s.n}</td><td>${s.gens}</td><td>${Math.round(s.secs)}</td><td>${s.passed}/${s.n}</td><td>${f2(s.colours.m)} ± ${f2(s.colours.sd)}</td><td>${pct(s.outlineShare.m)} ± ${pct(s.outlineShare.sd)}</td><td>${Math.round(s.edgeLuma.m)} ± ${Math.round(s.edgeLuma.sd)}</td><td>${pct(s.edgeDensity.m)} ± ${pct(s.edgeDensity.sd)}</td><td>${f2(s.dither.m * 100)}% ± ${f2(s.dither.sd * 100)}</td><td>${f2(s.lumaSd.m)} ± ${f2(s.lumaSd.sd)}</td><td><b>${f2(s.spread.m)}</b> ± ${f2(s.spread.sd)}</td><td><b>${f2(s.toAnchor.m)}</b> ± ${f2(s.toAnchor.sd)}</td><td>${f2(s.histToAnchor.m)} ± ${f2(s.histToAnchor.sd)}</td></tr>`;
html += `</table><h2>Per Element</h2><p><small>Style distances between conditions for the same Element, and the share of pixels identical between two images (both transparent pixels ignored). <b>repeat</b> answers whether the seed is deterministic.</small></p>
<table><tr><th>element</th><th>style Δ base-s1 vs base-s2 (seed effect)</th><th>style Δ base-s1 vs style-s2</th><th>style Δ base-s1 vs style-s1</th><th>pixels same: base-s1 vs repeat-s1</th><th>base-s1 vs style-s1</th><th>base-s1 vs base-s2</th><th>base-s2 vs style-s2</th></tr>`;
for (const p of perEl) html += `<tr><td>${p.element}</td><td>${f2(p.seedEffect)}</td><td>${f2(p.styleS2vsBaseS1)}</td><td>${f2(p.styleS1vsBaseS1)}</td><td>${pct(p.pixSameRepeat)}</td><td>${pct(p.pixSameStyleS1)}</td><td>${pct(p.pixSameS2)}</td><td>${pct(p.pixSameStyleS2vsS2)}</td></tr>`;
html += `</table><h2>Failures</h2><ul>${manifest.filter((r) => r.error).map((r) => `<li>${r.condition}/${r.element}: <small>${esc(r.error)}</small></li>`).join("") || "<li>none</li>"}</ul>`;
writeFileSync("out/index.html", html);
console.log("wrote out/index.html");
console.table(Object.fromEntries(Object.entries<any>(summary).map(([k, s]) => [k, { n: s.n, passed: s.passed, colours: f2(s.colours.m), outline: pct(s.outlineShare.m), busy: pct(s.edgeDensity.m), spread: f2(s.spread.m), toAnchor: f2(s.toAnchor.m), palVsAnchor: f2(s.histToAnchor.m) }])));
console.table(perEl.map((p) => ({ element: p.element, seedEffect: f2(p.seedEffect), s2vsA: f2(p.styleS2vsBaseS1), s1vsA: f2(p.styleS1vsBaseS1), repeatSame: pct(p.pixSameRepeat), styleS1Same: pct(p.pixSameStyleS1) })));
