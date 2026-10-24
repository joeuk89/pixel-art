// Editing probe: edits on library Elements done in code, each checked by diffing pixels.
import { hex, palette, read, write, type Img } from "./png.ts";
import { rng } from "./raster.ts";
import { gateStill } from "../../../pipeline/lib/quality-gate.ts";

const root = new URL("../../../", import.meta.url).pathname;
const out = `${root}docs/research/local-pixel-engine`;
const lib = (id: string) => read(`${root}library/elements/${id}.png`);
const GH = palette(root, "golden-hour"), CN = palette(root, "cosy-night");

const clone = (img: Img): Img => ({ ...img, data: img.data.slice() });
const rgb = (img: Img, i: number) => (img.data[i * 4] << 16) | (img.data[i * 4 + 1] << 8) | img.data[i * 4 + 2];
const alpha = (img: Img, i: number) => img.data[i * 4 + 3];
const key = (img: Img, i: number) => (alpha(img, i) === 0 ? -1 : rgb(img, i));
function diff(a: Img, b: Img): number {
  if (a.width !== b.width || a.height !== b.height) return Infinity;
  let n = 0;
  for (let i = 0; i < a.width * a.height; i++) if (key(a, i) !== key(b, i)) n++;
  return n;
}
const gate = (img: Img, pal: string[], kind: "prop" | "backdrop" = "prop") =>
  gateStill(img, { kind, canvas: { width: img.width, height: img.height }, palette: pal, targetBox: { width: img.width, height: img.height } } as never);
const report = (name: string, facts: Record<string, unknown>) => console.log(name, JSON.stringify(facts));

function crop(img: Img, x0: number, y0: number, w: number, h: number): Img {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, data };
}
function bbox(img: Img) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (alpha(img, y * img.width + x)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function flipX(img: Img): Img {
  const o = clone(img);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) o.data.set(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4), (y * img.width + img.width - 1 - x) * 4);
  return o;
}
function oklab(c: number): [number, number, number] {
  const f = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [f(c >> 16), f((c >> 8) & 255), f(c & 255)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const toInt = (h: string) => parseInt(h.slice(1), 16);
function nearest(c: number, pal: string[]): number {
  const a = oklab(c);
  let best = 0, bd = Infinity;
  pal.forEach((h, i) => { const b = oklab(toInt(h)); const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; if (d < bd) { bd = d; best = i; } });
  return toInt(pal[best]);
}
function remap(img: Img, map: (c: number) => number): Img {
  const o = clone(img);
  for (let i = 0; i < img.width * img.height; i++) if (alpha(img, i)) { const c = map(rgb(img, i)); o.data.set([c >> 16, (c >> 8) & 255, c & 255], i * 4); }
  return o;
}
const coloursOf = (img: Img) => { const s = new Set<number>(); for (let i = 0; i < img.width * img.height; i++) if (alpha(img, i)) s.add(rgb(img, i)); return s; };

// 1. Trim, then flip.
{
  const lamp = lib("lamp-floor-linen-drum-01");
  const b = bbox(lamp);
  const t = crop(lamp, b.x, b.y, b.w, b.h);
  let lost = 0;
  for (let i = 0; i < lamp.width * lamp.height; i++) if (alpha(lamp, i)) lost++;
  for (let i = 0; i < t.width * t.height; i++) if (alpha(t, i)) lost--;
  write(`${out}/edit-trim-lamp.png`, t);
  const f = flipX(t);
  write(`${out}/edit-flip-lamp.png`, f);
  report("trim+flip lamp", { from: `${lamp.width}x${lamp.height}`, bbox: b, opaqueLost: lost, flipTwiceDiff: diff(flipX(f), t), gate: gate(f, CN).ok });
}

// 2. Recolour golden-hour -> cosy-night by nearest Oklab colour, per colour (a lookup table, so equal pixels stay equal).
{
  const src = lib("child-asleep-beanbag-red-01");
  const table = new Map<number, number>();
  for (const c of coloursOf(src)) table.set(c, nearest(c, CN));
  const r = remap(src, (c) => table.get(c)!);
  write(`${out}/edit-recolour-child-cosy-night.png`, r);
  const merged = coloursOf(src).size - coloursOf(r).size;
  const alphaChanged = [...Array(src.width * src.height).keys()].filter((i) => alpha(src, i) !== alpha(r, i)).length;
  report("recolour child", { srcColours: coloursOf(src).size, outColours: coloursOf(r).size, coloursMerged: merged, alphaChanged, gate: gate(r, CN).ok,
    table: [...table].map(([a, b]) => `#${a.toString(16).padStart(6, "0")}->#${b.toString(16).padStart(6, "0")}`) });
}

// 3. Cleanup: inject strays into the window frame, clean, and diff against the original.
{
  const orig = lib("window-frame-square-wood-01");
  const dirty = clone(orig), r = rng(42), injected = new Set<number>();
  const opaque = [...Array(orig.width * orig.height).keys()].filter((i) => alpha(orig, i));
  for (let k = 0; k < 30; k++) {
    const i = opaque[Math.floor(r() * opaque.length)];
    injected.add(i);
    const [cr, cg, cb] = hex(GH[Math.floor(r() * GH.length)]);
    if (k < 10) dirty.data.set([Math.min(255, cr + 4), cg, Math.max(0, cb - 3), 255], i * 4); // off-Palette near-miss
    else if (k < 20) dirty.data.set([cr, cg, cb, 255], i * 4); // a wrong Palette colour, likely an orphan
    else dirty.data[i * 4 + 3] = 128; // soft alpha
  }
  const pal = new Set(GH.map(toInt));
  const clean = clone(dirty);
  for (let i = 0; i < clean.width * clean.height; i++) {
    const a = alpha(clean, i);
    if (a !== 0 && a !== 255) clean.data[i * 4 + 3] = a >= 128 ? 255 : 0;
    if (alpha(clean, i) && !pal.has(rgb(clean, i))) { const c = nearest(rgb(clean, i), GH); clean.data.set([c >> 16, (c >> 8) & 255, c & 255], i * 4); }
  }
  // An orphan is a pixel with no same-coloured 8-neighbour; replace it with the colour most of its 4 neighbours share, if 3 or 4 agree.
  const before = clone(clean);
  let fixedOrphans = 0;
  for (let y = 0; y < clean.height; y++) for (let x = 0; x < clean.width; x++) {
    const i = y * clean.width + x, c = key(before, i);
    if (c < 0) continue;
    const at = (dx: number, dy: number) => { const nx = x + dx, ny = y + dy; return nx < 0 || ny < 0 || nx >= clean.width || ny >= clean.height ? -2 : key(before, ny * clean.width + nx); };
    let same = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(dx, dy) === c) same = true;
    if (same) continue;
    const counts = new Map<number, number>();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = at(dx, dy); if (n >= 0) counts.set(n, (counts.get(n) ?? 0) + 1); }
    const [best, count] = [...counts].sort((p, q) => q[1] - p[1])[0] ?? [0, 0];
    if (count >= 3) { clean.data.set([best >> 16, (best >> 8) & 255, best & 255, 255], i * 4); fixedOrphans++; }
  }
  let restored = 0, stillWrong = 0, collateral = 0;
  for (let i = 0; i < orig.width * orig.height; i++) {
    const ok = key(clean, i) === key(orig, i);
    if (injected.has(i)) ok ? restored++ : stillWrong++;
    else if (!ok) collateral++;
  }
  write(`${out}/edit-cleanup-dirty.png`, dirty);
  write(`${out}/edit-cleanup-clean.png`, clean);
  report("cleanup window", { injected: injected.size, restored, stillWrong, collateral, fixedOrphans, gateDirty: gate(dirty, GH).failed, gateClean: gate(clean, GH).ok });
}

// 4. Can I read pixel positions by eye? Estimates written down from the 8x view before measuring.
{
  const wf = lib("window-frame-square-wood-01");
  const estimate = { topLeftPane: { x0: 13, y0: 11, x1: 36, y1: 34 }, mullionOutlineX: [37, 42], railOutlineY: [35, 42] };
  // Truth: transparent components that do not touch the canvas edge are the panes.
  const seen = new Uint8Array(wf.width * wf.height), panes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  for (let s = 0; s < wf.width * wf.height; s++) {
    if (alpha(wf, s) || seen[s]) continue;
    const st = [s]; seen[s] = 1;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, edge = false;
    while (st.length) {
      const p = st.pop()!, x = p % wf.width, y = (p - x) / wf.width;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      if (x === 0 || y === 0 || x === wf.width - 1 || y === wf.height - 1) edge = true;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= wf.width || ny >= wf.height) continue;
        const q = ny * wf.width + nx;
        if (!alpha(wf, q) && !seen[q]) { seen[q] = 1; st.push(q); }
      }
    }
    if (!edge) panes.push({ x0, y0, x1, y1 });
  }
  panes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const truth = { topLeftPane: panes[0], mullionOutlineX: [panes[0].x1 + 1, panes[1].x0 - 1], railOutlineY: [panes[0].y1 + 1, panes[2].y0 - 1] };
  report("eye vs truth", { estimate, truth, panes });

  // 5. A small redraw placed from measured structure, not by eye: a 4x2 brass latch centred on the bottom rail under the mullion.
  const latch = clone(wf);
  const cx = Math.round((truth.mullionOutlineX[0] + truth.mullionOutlineX[1]) / 2) - 2, cy = panes[2].y1 + 3;
  const brass = [GH[6], GH[6], GH[5], GH[4]].map(hex);
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 4; dx++) latch.data.set([...(dy === 0 ? brass[dx] : hex(GH[2])), 255], ((cy + dy) * wf.width + cx + dx) * 4);
  write(`${out}/edit-redraw-latch.png`, latch);
  report("latch", { at: { x: cx, y: cy }, pixelsChanged: diff(wf, latch), gate: gate(latch, GH).ok });
}

// 6. Extend an edge: widen the tiling plank wall from 128 to 192 px by its measured horizontal period.
{
  const wall = lib("wall-plank-wood-honey-01");
  const colMismatch = (a: number, b: number) => { let n = 0; for (let y = 0; y < wall.height; y++) if (key(wall, y * wall.width + a) !== key(wall, y * wall.width + b)) n++; return n; };
  const wrap = colMismatch(127, 0), neighbour = [...Array(127).keys()].reduce((s, x) => s + colMismatch(x, x + 1), 0) / 127;
  const W = 192, ext: Img = { width: W, height: wall.height, data: new Uint8Array(W * wall.height * 4) };
  for (let y = 0; y < wall.height; y++) for (let x = 0; x < W; x++) ext.data.set(wall.data.subarray((y * wall.width + (x % wall.width)) * 4, (y * wall.width + (x % wall.width)) * 4 + 4), (y * W + x) * 4);
  write(`${out}/edit-extend-wall-192.png`, ext);
  report("extend wall", { wrapSeamMismatch: wrap, meanNeighbourMismatch: +neighbour.toFixed(1), originalUntouched: diff(crop(ext, 0, 0, 128, 64), wall) });
}

// 7. Seam repair between two overlapping backdrop strips: a minimum-error cut through the overlap instead of a straight one.
{
  const sky = lib("city-skyline-river-night-01");
  const A = crop(sky, 0, 0, 80, 64);
  const B = crop(sky, 48, 0, 80, 64);
  // Simulate a separately generated strip whose content landed one pixel lower.
  const Bn = clone(B);
  for (let y = B.height - 1; y > 0; y--) Bn.data.copyWithin(y * B.width * 4, (y - 1) * B.width * 4, y * B.width * 4);
  const O = 32, W = 128;
  const err = (x: number, y: number) => (key(A, y * 80 + 48 + x) === key(Bn, y * 80 + x) ? 0 : 1);
  const straight = (cut: number[]) => {
    const o: Img = { width: W, height: 64, data: new Uint8Array(W * 64 * 4) };
    for (let y = 0; y < 64; y++) for (let x = 0; x < W; x++) {
      const fromA = x < 48 + cut[y];
      const src = fromA ? A : Bn, sx = fromA ? x : x - 48;
      o.data.set(src.data.subarray((y * 80 + sx) * 4, (y * 80 + sx) * 4 + 4), (y * W + x) * 4);
    }
    return o;
  };
  // Dynamic programming over the overlap: each row's cut column moves at most one from the row above.
  const cost = Array.from({ length: 64 }, () => new Float64Array(O)), from = Array.from({ length: 64 }, () => new Int8Array(O));
  for (let y = 0; y < 64; y++) for (let x = 0; x < O; x++) {
    let best = 0, dir = 0;
    if (y > 0) { best = Infinity; for (const d of [-1, 0, 1]) { const px = x + d; if (px >= 0 && px < O && cost[y - 1][px] < best) { best = cost[y - 1][px]; dir = d; } } }
    cost[y][x] = best + err(x, y) + (y > 0 ? 0 : 0);
    from[y][x] = dir;
  }
  let x = [...cost[63].keys()].reduce((b, i) => (cost[63][i] < cost[63][b] ? i : b), 0);
  const cut = new Array<number>(64);
  for (let y = 63; y >= 0; y--) { cut[y] = x; x += from[y][x]; }
  const mid = new Array(64).fill(O / 2);
  const seamErr = (c: number[]) => c.reduce((s, cx, y) => s + err(Math.min(O - 1, cx), y), 0);
  write(`${out}/edit-seam-straight.png`, straight(mid));
  write(`${out}/edit-seam-mincut.png`, straight(cut));
  report("seam", { straightCutMismatches: seamErr(mid), minCutMismatches: seamErr(cut), wholeOverlapMismatches: [...Array(64 * O).keys()].reduce((s, i) => s + err(i % O, (i / O) | 0), 0) });
}
