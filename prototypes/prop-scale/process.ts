// PROTOTYPE. Runs the #20 Quality gate on every raw prop (dimensions, binary alpha, palette membership, trimmed
// height, islands), measures style traits against the 64 px anchor, gates the cat strips, composites the Scene at
// 192x120 and writes out/index.html.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import sharp from "sharp";
import { PALETTE } from "./palette.ts";
import { ALL, PROPS, CUSTOMS, ANCHOR, CONDITIONS, STRIPS, type Spec } from "./elements.ts";

type Rec = { kind: string; condition: string; element: string; file: string; usage?: any; ms: number; error?: string; frames?: number };
const manifest: Rec[] = JSON.parse(readFileSync("out/manifest.json", "utf8"));
for (const d of ["out/preview", "out/composite", "out/strips"]) mkdirSync(d, { recursive: true });

const rgb = PALETTE.map((h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
const luma = rgb.map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
const idxOf = new Map(rgb.map(([r, g, b], i) => [(r << 16) | (g << 8) | b, i]));
const nearest = (r: number, g: number, b: number) => { let best = 0, bd = Infinity; rgb.forEach(([pr, pg, pb], i) => { const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2; if (d < bd) { bd = d; best = i; } }); return best; };

type M = { hard: string[]; warn: string[]; w: number; h: number; opaque: number; colours: number; outlineShare: number; edgeDensity: number; dither: number; lumaSd: number; trimW: number; trimH: number; trimHPct: number; islands: number; hist: number[] };
function indexed(data: Buffer, w: number, h: number) {
  const idx = new Int16Array(w * h).fill(-1);
  let offPal = 0, softA = 0, opaque = 0;
  for (let p = 0; p < w * h; p++) {
    const a = data[p * 4 + 3];
    if (a !== 0 && a !== 255) softA++;
    if (a < 128) continue;
    opaque++;
    const i = idxOf.get((data[p * 4] << 16) | (data[p * 4 + 1] << 8) | data[p * 4 + 2]);
    if (i === undefined) { offPal++; idx[p] = nearest(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]); } else idx[p] = i;
  }
  return { idx, offPal, softA, opaque };
}
function islandsOf(idx: Int16Array, w: number, h: number) {
  const seen = new Uint8Array(w * h); let n = 0; const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (idx[s] < 0 || seen[s]) continue;
    n++; stack.push(s); seen[s] = 1;
    while (stack.length) { const p = stack.pop()!; const x = p % w, y = (p / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const q = ny * w + nx; if (idx[q] >= 0 && !seen[q]) { seen[q] = 1; stack.push(q); } } }
  }
  return n;
}
async function measure(file: string, w0: number, h0: number): Promise<M> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const { idx, offPal, softA, opaque } = indexed(data, w, h);
  const hard: string[] = [], warn: string[] = [];
  if (w !== w0 || h !== h0) hard.push(`size ${w}x${h}`);
  if (softA) hard.push(`soft alpha ${softA}`);
  if (offPal) hard.push(`off-palette ${offPal}`);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -2 : idx[y * w + x]);
  let edge = 0, edgeDark = 0, busy = 0, dither = 0, lsum = 0, l2 = 0;
  const hist = new Array(PALETTE.length).fill(0);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y); if (c < 0) continue;
    hist[c]++; lsum += luma[c]; l2 += luma[c] * luma[c];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    const n = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
    if (n.some((v) => v === -1)) { edge++; if (c <= 1) edgeDark++; }
    if (n.some((v) => v >= 0 && v !== c)) busy++;
    if (n[0] >= 0 && n[0] === n[1] && n[0] !== c && n[2] >= 0 && n[2] === n[3] && n[2] !== c) dither++;
  }
  const mean = lsum / opaque, sd = Math.sqrt(Math.max(0, l2 / opaque - mean * mean));
  const trimW = maxX < 0 ? 0 : maxX - minX + 1, trimH = maxY < 0 ? 0 : maxY - minY + 1, trimHPct = trimH / h0;
  const islands = islandsOf(idx, w, h);
  if (trimHPct < 0.4) warn.push(`trimmed height ${Math.round(trimHPct * 100)}%`);
  if (islands > 6) warn.push(`${islands} islands`);
  return { hard, warn, w, h, opaque, colours: hist.filter((n) => n > 0).length, outlineShare: edge ? edgeDark / edge : NaN, edgeDensity: busy / opaque, dither: dither / opaque, lumaSd: sd, trimW, trimH, trimHPct, islands, hist: hist.map((n) => n / opaque) };
}
const vec = (m: M) => [m.colours / 16, isNaN(m.outlineShare) ? 0 : m.outlineShare, m.edgeDensity, m.dither * 10, m.lumaSd / 80];
const dist = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
const histDist = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / 2;

const anchorM = await measure(ANCHOR.file, ANCHOR.w, ANCHOR.h);
const results = new Map<string, M>();
const key = (c: string, e: string) => `${c}/${e}`;
const zoom = (s: { w: number; h: number }) => Math.max(2, Math.round(256 / Math.max(s.w, s.h)) );
for (const r of manifest) {
  if (r.kind !== "image" || r.error || !existsSync(r.file)) continue;
  const e = ALL.find((x) => x.id === r.element)!;
  results.set(key(r.condition, r.element), await measure(r.file, e.w, e.h));
  await sharp(r.file).resize(e.w * zoom(e), e.h * zoom(e), { kernel: "nearest" }).png().toFile(`out/preview/${r.condition}-${r.element}.png`);
}
await sharp(ANCHOR.file).resize(256, 256, { kernel: "nearest" }).png().toFile("out/preview/anchor-window.png");

// ---- Strips: snap to palette, then the #20 strip gate (motion >= 1%, drift <= 10%, seam <= 1.5x mean step) ----
type S = { condition: string; element: string; returnedStill?: boolean; frames: number; offPalettePct: number; motion: number[]; motionAvg: number; drift: number; seam: number; pass: boolean; why: string[]; error?: string };
const stripStats: S[] = [];
for (const r of manifest.filter((r) => r.kind === "strip")) {
  if (r.error) { stripStats.push({ condition: r.condition, element: r.element, frames: 0, offPalettePct: 0, motion: [], motionAvg: 0, drift: 0, seam: 0, pass: false, why: [], error: r.error }); continue; }
  const e = ALL.find((x) => x.id === r.element)!;
  const { data, info } = await sharp(r.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width / e.w;
  const why: string[] = [];
  if (!Number.isInteger(n) || info.height !== e.h) why.push(`strip ${info.width}x${info.height}`);
  const frame = (i: number) => { const f = Buffer.alloc(e.w * e.h * 4); for (let y = 0; y < e.h; y++) data.copy(f, y * e.w * 4, (y * info.width + i * e.w) * 4, (y * info.width + (i + 1) * e.w) * 4); return f; };
  const still = await sharp(`out/raw/${r.condition}-${r.element}.png`).ensureAlpha().raw().toBuffer();
  const snap = (f: Buffer) => { const o = Buffer.alloc(f.length); let off = 0, op = 0; for (let i = 0; i < f.length; i += 4) { if (f[i + 3] < 128) continue; op++; const k = idxOf.get((f[i] << 16) | (f[i + 1] << 8) | f[i + 2]); if (k === undefined) off++; const c = rgb[k ?? nearest(f[i], f[i + 1], f[i + 2])]; o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2]; o[i + 3] = 255; } return { o, off: op ? off / op : 0 }; };
  const diff = (a: Buffer, b: Buffer) => { let d = 0; for (let i = 0; i < a.length; i += 4) { const oa = a[i + 3] >= 128, ob = b[i + 3] >= 128; if (oa !== ob || (oa && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]))) d++; } return d / (a.length / 4); };
  const raw = Array.from({ length: n }, (_, i) => frame(i));
  const snapped = raw.map(snap);
  // animate v3 returns frame_count + 1 images and the first is the still verbatim, so frame 0 is the still (#25)
  // without prepending it; prepend only if a future response omits it.
  const stillSnapped = snap(still).o;
  const fs = diff(stillSnapped, snapped[0].o) === 0 ? snapped.map((s) => s.o) : [stillSnapped, ...snapped.map((s) => s.o)];
  const returnedStill = diff(stillSnapped, snapped[0].o) === 0;
  const motion = fs.slice(1).map((f, i) => diff(fs[i], f));
  const motionAvg = motion.reduce((a, b) => a + b, 0) / motion.length;
  const drift = diff(fs[0], fs[fs.length - 1]), seam = diff(fs[fs.length - 1], fs[0]);
  if (motionAvg < 0.01) why.push(`motion ${(motionAvg * 100).toFixed(1)}% < 1%`);
  if (drift > 0.1) why.push(`drift ${(drift * 100).toFixed(1)}% > 10%`);
  if (seam > 1.5 * motionAvg) why.push(`seam ${(seam * 100).toFixed(1)}% > 1.5x step`);
  const z = zoom(e);
  const png = await sharp({ create: { width: e.w * fs.length, height: e.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(fs.map((f, i) => ({ input: f, raw: { width: e.w, height: e.h, channels: 4 }, left: i * e.w, top: 0 }))).png().toBuffer();
  await sharp(png).resize(e.w * fs.length * z, e.h * z, { kernel: "nearest" }).png().toFile(`out/strips/${r.condition}-${r.element}.png`);
  stripStats.push({ condition: r.condition, element: r.element, returnedStill, frames: fs.length, offPalettePct: snapped.reduce((a, s) => a + s.off, 0) / n, motion, motionAvg, drift, seam, pass: !why.length, why });
}

// ---- Composites at 192x120, Scale 40 px/m, floor line at y=104 ----
const comps: string[] = [];
// A composite set picks one condition per prop: the as-is anchor where it fits, else crop or shrink; or plain.
const fits = (e: Spec) => e.w >= ANCHOR.w && e.h >= ANCHOR.h;
const SETS = [
  { id: "styled-crop", pick: (e: Spec) => (fits(e) ? "style" : "crop") },
  { id: "styled-shrink", pick: (e: Spec) => (fits(e) ? "style" : "shrink") },
  { id: "plain", pick: () => "plain" },
];
for (const c of SETS) {
  const t: Record<string, { input: Buffer; w: number; h: number }> = {};
  for (const e of PROPS) if (results.has(key(c.pick(e), e.id))) { const b = await sharp(`out/raw/${c.pick(e)}-${e.id}.png`).trim({ threshold: 0 }).toBuffer(); const m = await sharp(b).metadata(); t[e.id] = { input: b, w: m.width!, h: m.height! }; }
  const anchor = await sharp(ANCHOR.file).trim({ threshold: 0 }).toBuffer(); const am = await sharp(anchor).metadata();
  const rect = async (w: number, h: number, bg: string) => sharp({ create: { width: w, height: h, channels: 4, background: bg } }).png().toBuffer();
  const bottom = (id: string, left: number, b: number) => t[id] ? [{ input: t[id].input, left, top: b - t[id].h }] : [];
  const centre = (id: string, cx: number, b: number) => t[id] ? bottom(id, Math.round(cx - t[id].w / 2), b) : [];
  const base = [
    { input: "out/raw/skyline.png", left: 0, top: 0 }, { input: "out/raw/skyline.png", left: 128, top: 0 },
    { input: await rect(192, 16, PALETTE[2]), left: 0, top: 104 },
    { input: anchor, left: 96 - Math.round(am.width! / 2), top: 10 },
    ...centre("clock-24", 164, 10 + (t["clock-24"]?.h ?? 0)),
  ];
  const deskTop = 104 - (t["desk-96x64"]?.h ?? 30);
  const study = await sharp({ create: { width: 192, height: 120, channels: 4, background: PALETTE[1] } }).composite([
    ...base, ...bottom("bookshelf-96", 2, 104), ...centre("desk-96x64", 96, 104),
    ...centre("lamp-32", 64, deskTop + 1), ...centre("radio-24", 96, deskTop + 1), ...centre("mug-16", 118, deskTop + 1),
    ...centre("plant-32", 150, 104), ...centre("armchair-48", 170, 104), ...centre("cat-32x24", 138, 104),
  ]).png().toBuffer();
  const lounge = await sharp({ create: { width: 192, height: 120, channels: 4, background: PALETTE[1] } }).composite([
    ...base, ...bottom("bookshelf-96", 2, 104), ...centre("sofa-128", 120, 104), ...centre("plant-32", 56, 104),
    ...centre("cat-32x24", 120, 104 - 8), ...centre("lamp-32", 180, 104),
  ]).png().toBuffer();
  for (const [name, png] of [["study", study], ["lounge", lounge]] as const) {
    writeFileSync(`out/composite/${c.id}-${name}.png`, png);
    await sharp(png).resize(192 * 5, 120 * 5, { kernel: "nearest" }).png().toFile(`out/composite/${c.id}-${name}@5x.png`);
    comps.push(`${c.id}-${name}`);
  }
}

// ---- Numbers ----
const f2 = (n: number) => (isNaN(n) ? "-" : n.toFixed(2));
const pct = (n: number) => (isNaN(n) ? "-" : Math.round(n * 100) + "%");
const bucket = (s: Spec) => (Math.max(s.w, s.h) <= 32 ? "small (16-32)" : Math.max(s.w, s.h) <= 64 ? "mid (48-64)" : "large (96-128)");
const mean = (xs: number[]) => { const v = xs.filter((x) => !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
const byBucket: Record<string, Record<string, { n: number; toAnchor: number; palVsAnchor: number; colours: number; outline: number; busy: number; hardFails: number; warns: number }>> = {};
for (const b of ["small (16-32)", "mid (48-64)", "large (96-128)"]) {
  byBucket[b] = {};
  for (const c of CONDITIONS) {
    const ms = ALL.filter((s) => bucket(s) === b).map((s) => results.get(key(c.id, s.id))).filter(Boolean) as M[];
    if (!ms.length) continue;
    byBucket[b][c.id] = { n: ms.length, toAnchor: mean(ms.map((m) => dist(vec(m), vec(anchorM)))), palVsAnchor: mean(ms.map((m) => histDist(m.hist, anchorM.hist))), colours: mean(ms.map((m) => m.colours)), outline: mean(ms.map((m) => m.outlineShare)), busy: mean(ms.map((m) => m.edgeDensity)), hardFails: ms.filter((m) => m.hard.length).length, warns: ms.filter((m) => m.warn.length).length };
  }
}
const cells = Object.fromEntries([...results].map(([k, m]) => [k, { ...m, hist: undefined }]));
writeFileSync("out/stats.json", JSON.stringify({ anchor: { ...anchorM, hist: undefined }, byBucket, strips: stripStats, cells }, null, 2));

// ---- Sheet ----
const esc = (s: unknown) => String(s).replace(/</g, "&lt;");
const cell = (c: string, e: Spec) => {
  const m = results.get(key(c, e.id)); const r = manifest.find((x) => x.kind === "image" && x.condition === c && x.element === e.id);
  if (!m) return `<td><small class="bad">${r?.error ? esc(r.error.slice(0, 160)) : ""}</small></td>`;
  const flags = [...m.hard.map((x) => `<span class="bad">${esc(x)}</span>`), ...m.warn.map((x) => `<span class="warn">${esc(x)}</span>`)].join(" ");
  return `<td><img src="preview/${c}-${e.id}.png" style="width:${e.w * zoom(e)}px"><br><small>${flags ? flags + "<br>" : ""}${m.colours} col, trim ${m.trimW}x${m.trimH} (${pct(m.trimHPct)} h), ${m.islands} isl, outline ${pct(m.outlineShare)}, busy ${pct(m.edgeDensity)}, Δanchor ${f2(dist(vec(m), vec(anchorM)))}</small></td>`;
};
let html = `<!doctype html><meta charset="utf-8"><title>Prop scale prototype</title>
<style>body{font:14px system-ui;background:#1b1b1f;color:#ddd;margin:24px}h1,h2,h3{font-weight:600}img{image-rendering:pixelated;vertical-align:top;background:#2a2a30}
table{border-collapse:collapse}td,th{padding:5px 8px;border-bottom:1px solid #444;text-align:left;vertical-align:top}th{color:#aaa;font-weight:500}
.grid td{text-align:center}small{color:#999}.bad{color:#f66}.warn{color:#fc6}.comp img{margin:0 12px 12px 0}.sw{display:inline-block;width:18px;height:18px;border:1px solid #000;margin-right:1px}</style>
<h1>Mixed prop sizes under a 64 px Style anchor (wayfinder #28)</h1>
<p>Palette ${PALETTE.map((p) => `<span class="sw" style="background:${p}"></span>`).join("")} <small>Cosy Night 16 as <code>target_palette</code>. Scale 40 px/m. Raw PNGs as PixelLab returned them. Every preview is zoomed so its canvas is about 256 px wide: a 16 px mug is shown at 16x, a 128 px sofa at 2x. Judge style at that zoom, then check the composites at 5x, where everything is at true relative size.</small></p>
<p><b>Conditions.</b> Pro Flash rejects a <code>style_image</code> larger than the target canvas ("Style image must fit the native canvas"), so: <code>style</code> = the 64x64 window below as-is, only for targets of at least 64x64; <code>crop</code> = the window centre-cropped to the target box; <code>shrink</code> = the window nearest-downscaled to fit the target; <code>plain</code> = no style image; <code>crop2</code> = a second roll of the sub-32 props under <code>crop</code>. All four <code>style_options</code> on whenever a style image is sent.</p>
<p><b>Anchor</b><br><img src="preview/anchor-window.png" style="width:256px"></p>
<h2>Composites (5x, true relative size)</h2><div class="comp">${comps.map((n) => `<div><b>${n}</b><br><img src="composite/${n}@5x.png"></div>`).join("")}</div>
<h2>Main set: each prop at its Scale-derived canvas</h2><table class="grid"><tr><th>prop</th>${CONDITIONS.map((c) => `<th>${c.id}</th>`).join("")}</tr>`;
for (const e of PROPS) html += `<tr><th>${e.id}<br><small>${e.w}x${e.h} ${e.native ? "native" : "custom"}<br>${e.realSize}</small></th>${CONDITIONS.map((c) => cell(c.id, e)).join("")}</tr>`;
html += `</table><h2>Custom sizes next to their native neighbours</h2><table class="grid"><tr><th>prop</th>${CONDITIONS.map((c) => `<th>${c.id}</th>`).join("")}</tr>`;
const pair = (s: Spec) => ALL.find((x) => x.subject === s.subject && x !== s && (PROPS.includes(x)));
for (const e of CUSTOMS) {
  const p = pair(e);
  if (p) html += `<tr><th>${p.id}<br><small>${p.w}x${p.h} ${p.native ? "native" : "custom"}</small></th>${CONDITIONS.map((c) => cell(c.id, p)).join("")}</tr>`;
  html += `<tr><th>${e.id}<br><small>${e.w}x${e.h} ${e.native ? "native" : "custom"}<br>${e.realSize}</small></th>${CONDITIONS.map((c) => cell(c.id, e)).join("")}</tr>`;
}
html += `</table><h2>Strips: animate v3, 4 frames, on the small cat</h2><p><small>Frame 0 is the still; frames snapped to the palette before gating. Gate: motion ≥ 1% per step, drift from the still ≤ 10%, seam ≤ 1.5x the mean step.</small></p><table><tr><th>strip</th><th>frames returned (first = still?)</th><th>off-palette before snap</th><th>motion per step</th><th>drift</th><th>seam</th><th>gate</th></tr>`;
for (const s of stripStats) html += s.error ? `<tr><td>${s.condition}/${s.element}</td><td colspan=6 class="bad"><small>${esc(s.error)}</small></td></tr>` : `<tr><td>${s.condition}/${s.element}<br><img src="strips/${s.condition}-${s.element}.png"></td><td>${s.frames} (${s.returnedStill ? "yes" : "no"})</td><td>${pct(s.offPalettePct)}</td><td>${s.motion.map((m) => pct(m)).join(", ")}</td><td>${pct(s.drift)}</td><td>${pct(s.seam)}</td><td>${s.pass ? "pass" : `<span class="bad">${s.why.map(esc).join("; ")}</span>`}</td></tr>`;
html += `</table><h2>Style hold by size bucket</h2><p><small><b>Δ anchor</b>: mean distance from the anchor on the style vector (colours used, dark-outline share, busy share, dither, contrast); style-lock measured 0.49 (styled) vs 0.52-0.55 (plain) at 64 px. <b>palette use vs anchor</b>: 0 same, 1 disjoint.</small></p>
<table><tr><th>bucket</th><th>condition</th><th>n</th><th>Δ anchor</th><th>palette use vs anchor</th><th>colours</th><th>dark outline</th><th>busy</th><th>hard fails</th><th>warnings</th></tr>`;
for (const [b, conds] of Object.entries(byBucket)) for (const [c, s] of Object.entries(conds)) html += `<tr><td>${b}</td><td>${c}</td><td>${s.n}</td><td><b>${f2(s.toAnchor)}</b></td><td>${f2(s.palVsAnchor)}</td><td>${f2(s.colours)}</td><td>${pct(s.outline)}</td><td>${pct(s.busy)}</td><td>${s.hardFails}</td><td>${s.warns}</td></tr>`;
html += `</table><h2>Failures</h2><ul>${manifest.filter((r) => r.error).map((r) => `<li>${r.kind} ${r.condition}/${r.element}: <small>${esc(r.error)}</small></li>`).join("") || "<li>none</li>"}</ul>`;
writeFileSync("out/index.html", html);
console.log("wrote out/index.html");
for (const [b, conds] of Object.entries(byBucket)) console.table(Object.fromEntries(Object.entries(conds).map(([c, s]) => [`${b} ${c}`, { n: s.n, dAnchor: f2(s.toAnchor), pal: f2(s.palVsAnchor), colours: f2(s.colours), outline: pct(s.outline), busy: pct(s.busy), hard: s.hardFails, warn: s.warns }])));
console.table(stripStats.map((s) => ({ strip: `${s.condition}/${s.element}`, frames: s.frames, motion: f2(s.motionAvg * 100), drift: f2(s.drift * 100), seam: f2(s.seam * 100), gate: s.error ? "ERR" : s.pass ? "pass" : s.why.join("; ") })));
