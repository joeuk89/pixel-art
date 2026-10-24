// Capability probe: Elements written as code or data, rendered locally, then put through the real Quality gate.
import { fromGrid, palette, write, type Img } from "./png.ts";
import { Grid, ellipse, lambert, rng, step } from "./raster.ts";
import { gateStill } from "../../../pipeline/lib/quality-gate.ts";

const root = new URL("../../../", import.meta.url).pathname;
const out = `${root}docs/research/local-pixel-engine`;
const GH = palette(root, "golden-hour");
const CN = palette(root, "cosy-night");

// golden-hour wood ramp, dark to light: 0 outline, 1, 2, 3, 4 base, 5 lit, 6 highlight
function windowFrame(): Img {
  const S = 64, T = 8, g = new Grid(S, S), r = rng(7);
  const mid = [30, 31, 32, 33];
  const grain = new Map<string, number>();
  for (let i = 0; i < 70; i++) {
    const along = Math.floor(r() * S), across = 2 + Math.floor(r() * 4), len = 3 + Math.floor(r() * 6), c = r() < 0.6 ? 3 : 5;
    for (let k = 0; k < len; k++) grain.set(`${i % 4}:${along + k}:${across}`, c);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = [y, S - 1 - y, x, S - 1 - x]; // top, bottom, left, right
    const across = Math.min(...d);
    if (across < T) {
      const side = d.indexOf(across);
      const tie = d.filter((v) => v === across).length > 1;
      const along = side < 2 ? x : y;
      let c = grain.get(`${side}:${along}:${across}`) ?? 4;
      if (across === 1) c = side === 0 || side === 2 ? 5 : 2;
      if (across === T - 2) c = side === 0 || side === 2 ? 2 : 5;
      if (tie && across > 0 && across < T - 1) c = 3;
      g.set(x, y, c, side);
    } else if (mid.includes(x) || mid.includes(y)) {
      const vertical = mid.includes(x);
      const a = vertical ? x - 30 : y - 30;
      g.set(x, y, a === 0 ? 5 : a === 3 ? 2 : 4, vertical ? 5 : 4);
    }
  }
  g.seam(4, 2, [[1, 0], [-1, 0]]);
  g.outline(0);
  return g.toImg(GH);
}

// A left side wall in forced perspective: vertical planks that narrow as the wall recedes, top and bottom edges on clean 2:1 steps.
function sideWall(): Img {
  const W = 32, H = 96, g = new Grid(W, H), r = rng(11);
  const seams = [0, 7, 13, 18, 22, 26, 29];
  for (let x = 0; x < W; x++) {
    const top = Math.floor(x / 2), bot = H - 1 - Math.floor(x / 2);
    const plank = seams.filter((s) => s <= x).length - 1;
    const far = x >= 18;
    for (let y = top; y <= bot; y++) {
      let c = far ? 3 : 4;
      if (seams.includes(x)) c = 1;
      else if (seams.includes(x - 1)) c = far ? 4 : 5;
      if (y <= top + 2) c = 2;
      if (y >= bot - 6) c = y === bot - 6 ? 3 : 2;
      g.set(x, y, c);
    }
    if (!seams.includes(x) && r() < 0.5 && plank >= 0) {
      const ky = top + 8 + Math.floor(r() * (bot - top - 20));
      g.set(x, ky, far ? 2 : 3);
    }
  }
  g.outline(0);
  return g.toImg(GH);
}

// A floor band: board rows get taller toward the front, back rows darker, end joints staggered.
function floor(): Img {
  const W = 128, rows = [2, 3, 3, 4, 5, 6, 8], g = new Grid(W, 32), r = rng(3);
  let y = 0;
  rows.forEach((h, i) => {
    const base = i < 3 ? 3 : 4, lit = i < 3 ? 4 : 5;
    let joint = Math.floor(r() * 40);
    for (let x = 0; x < W; x++) {
      if (x === joint) joint += 28 + Math.floor(r() * 30);
      for (let dy = 0; dy < h; dy++) {
        let c = dy === 0 ? 1 : dy === 1 && h > 3 ? lit : base;
        if (x === joint - 1 && dy > 0) c = 2;
        g.set(x, y + dy, c);
      }
    }
    y += h;
  });
  g.rect(0, 31, W, 1, 0);
  return g.toImg(GH);
}

// A simple prop typed by hand as an indexed grid (cosy-night).
function mug(): Img {
  const rows = [
    "................",
    "................",
    "...oooooooooo...",
    "..occcccccccco..",
    "..ockkkkkkkkco..",
    "..occcccccccco..",
    "..o7c666666655o.",
    "..o76666666655oo",
    "..o7666666665oso",
    "..o7666666665oso",
    "..o7666666665oo.",
    "..o7666666665o..",
    "..o5666666555o..",
    "...o55555555o...",
    "....oooooooo....",
    "................",
  ];
  const key = { o: CN[0], c: CN[12], k: CN[11], 5: CN[5], 6: CN[6], 7: CN[7], s: CN[4] };
  return fromGrid(rows, key);
}

// A shaded, characterful prop from drawing commands: a curled sleeping cat, lit from the upper left.
function cat(): Img {
  const W = 48, H = 32, g = new Grid(W, H);
  const fur = step([11, 10, 9, 8], [0.25, 0.55, 0.85]);
  const stripes = (x: number, y: number, v: number) => (Math.sin(x * 0.9 + y * 0.25) > 0.75 && v < 0.8 ? 11 : fur(v));
  const body = { cx: 27, cy: 20, rx: 18, ry: 9 };
  const lb = lambert(body.cx, body.cy, body.rx, body.ry);
  g.fill(0, ellipse(body.cx, body.cy, body.rx, body.ry), (x, y) => stripes(x, y, lb(x, y)));
  const ring = (x: number, y: number) => { const e = ((x - 27) / 19.5) ** 2 + ((y - 19) / 10.5) ** 2; return e > 0.72 && e < 1.0 && y > 22 && x > 14; };
  g.fill(1, ring, (x, y) => (x > 38 ? 10 : 9));
  g.seam(1, 11, [[0, -1]]);
  const head = { cx: 12, cy: 17, rx: 8.5, ry: 7.5 };
  const lh = lambert(head.cx, head.cy, head.rx, head.ry);
  const ear = (ax: number, bx: number, tx: number, ty: number, by: number) => (x: number, y: number) => y <= by && y >= ty && x >= ax + (tx - ax) * (by - y) / (by - ty) && x <= bx + (tx - bx) * (by - y) / (by - ty);
  g.fill(2, (x, y) => ellipse(head.cx, head.cy, head.rx, head.ry)(x, y) || ear(5, 10, 6, 6, 12)(x, y) || ear(13, 18, 17, 6, 12)(x, y), (x, y) => fur(lh(x, y)));
  g.fill(3, ellipse(12, 20.5, 3.5, 2.2), () => 12);
  g.fill(4, (x, y) => ellipse(9, 25, 3, 1.8)(x, y) || ellipse(15, 25.5, 3, 1.8)(x, y), () => 12);
  g.seam(2, 0, [[1, 0], [0, 1]]);
  g.seam(4, 13, [[0, -1]]);
  g.outline(0);
  for (const [x, y, c] of [[8, 17, 0], [9, 18, 0], [10, 18, 0], [14, 18, 0], [15, 18, 0], [16, 17, 0], [12, 19, 10], [7, 9, 10], [16, 9, 10]] as const) g.set(x, y, c);
  return g.toImg(CN);
}


// Second pass at the cat after looking at the first: rounder head, smaller ears, stripes that follow the body, a tail with its own outline.
function cat2(): Img {
  const W = 48, H = 32, g = new Grid(W, H);
  const ramp = [11, 10, 9, 8];
  const fur = step(ramp, [0.25, 0.55, 0.85]);
  const darker = (c: number) => ramp[Math.max(0, ramp.indexOf(c) - 1)];
  const body = { cx: 28, cy: 20, rx: 17, ry: 8.5 };
  const lb = lambert(body.cx, body.cy, body.rx, body.ry);
  g.fill(0, ellipse(body.cx, body.cy, body.rx, body.ry), (x, y) => {
    const nx = (x - body.cx) / body.rx, ny = (y - body.cy) / body.ry, rad = Math.hypot(nx, ny), th = Math.atan2(ny, nx);
    const c = fur(lb(x, y));
    return rad > 0.35 && rad < 0.9 && ny < 0.3 && Math.sin(th * 10) > 0.8 ? darker(c) : c;
  });
  const ring = (x: number, y: number) => { const e = ((x - 28) / 19) ** 2 + ((y - 19) / 10.5) ** 2; return e > 0.74 && e < 1.0 && y > 23 && x > 15; };
  g.fill(1, ring, (x, y) => (y > 27.5 ? 10 : x > 40 ? 10 : 9));
  g.seam(1, 0, [[0, -1], [-1, 0], [1, 0]]);
  const head = { cx: 12, cy: 18.5, rx: 8, ry: 7 };
  const lh = lambert(head.cx, head.cy, head.rx, head.ry);
  const tri = (ax: number, bx: number, tx: number, ty: number, by: number) => (x: number, y: number) =>
    y <= by && y >= ty && x >= ax + (tx - ax) * (by - y) / (by - ty) && x <= bx + (tx - bx) * (by - y) / (by - ty);
  g.fill(2, (x, y) => ellipse(head.cx, head.cy, head.rx, head.ry)(x, y) || tri(5, 10, 6, 8, 14)(x, y) || tri(14, 19, 18, 8, 14)(x, y), (x, y) => fur(lh(x, y)));
  g.fill(3, (x, y) => tri(7, 9, 7, 11, 13)(x, y) || tri(15, 17, 17, 11, 13)(x, y), () => 13);
  g.fill(4, ellipse(12, 21.5, 3.6, 2.3), () => 12);
  g.fill(5, (x, y) => ellipse(9, 26, 3, 1.7)(x, y) || ellipse(15.5, 26.3, 3, 1.7)(x, y), () => 12);
  g.seam(2, 0, [[1, 0], [0, 1]]);
  g.seam(5, 13, [[0, -1]]);
  g.outline(0);
  const marks: Array<[number, number, number]> = [[8, 19, 0], [9, 20, 0], [10, 20, 0], [14, 20, 0], [15, 20, 0], [16, 19, 0], [12, 21, 10], [11, 22, 13], [13, 22, 13], [11, 13, 10], [12, 12, 10], [13, 13, 10]];
  for (const [x, y, c] of marks) g.set(x, y, c);
  return g.toImg(CN);
}

// A shaded prop from drawing commands: a glazed teapot, blue ramp, one cream glint.
function teapot(): Img {
  const S = 32, g = new Grid(S, S);
  const glaze = step([4, 5, 6, 7], [0.2, 0.5, 0.82]);
  const handle = (x: number, y: number) => { const d = Math.hypot(x - 7, y - 19); return d <= 6 && d >= 3.2 && x < 9; };
  g.fill(0, handle, (x, y) => (y < 18 ? 6 : 5));
  const spout = (x: number, y: number) => { const t = Math.max(0, Math.min(1, ((x - 23) * 6 + (y - 21) * -8) / 100)); const px = 23 + 6 * t, py = 21 - 8 * t; return Math.hypot(x - px, y - py) <= 2.2 - t * 0.6; };
  g.fill(1, spout, (x, y) => (x < 27 ? 6 : 5));
  const lb = lambert(16, 20, 10, 8);
  g.fill(2, ellipse(16, 20, 10, 8), (x, y) => glaze(lb(x, y)));
  g.fill(3, ellipse(16, 11.5, 5.5, 2), (x, y) => (y < 11.5 ? 7 : 6));
  g.fill(4, ellipse(16, 8.6, 1.6, 1.6), () => 6);
  g.seam(2, 4, [[0, -1], [1, 0], [-1, 0]]);
  g.seam(3, 4, [[0, 1]]);
  g.outline(0);
  for (const [x, y] of [[11, 15], [12, 15], [11, 16]]) g.set(x, y, 12);
  return g.toImg(CN);
}

function orphans(img: Img): number {
  let n = 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= img.width || y >= img.height ? -1 : img.data[(y * img.width + x) * 4 + 3] === 0 ? -1 : (img.data[(y * img.width + x) * 4] << 16) | (img.data[(y * img.width + x) * 4 + 1] << 8) | img.data[(y * img.width + x) * 4 + 2]);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const c = at(x, y);
    if (c < 0) continue;
    let same = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(x + dx, y + dy) === c) same = true;
    if (!same) n++;
  }
  return n;
}

const probes: Array<[string, Img, string[], "prop" | "backdrop"]> = [
  ["gen-window-frame-64", windowFrame(), GH, "prop"],
  ["gen-side-wall-32x96", sideWall(), GH, "prop"],
  ["gen-floor-band-128x32", floor(), GH, "prop"],
  ["gen-mug-16", mug(), CN, "prop"],
  ["gen-cat-48x32", cat(), CN, "prop"],
  ["gen-cat-48x32-pass2", cat2(), CN, "prop"],
  ["gen-teapot-32", teapot(), CN, "prop"],
];
for (const [name, img, pal, kind] of probes) {
  write(`${out}/${name}.png`, img);
  const gate = gateStill(img, { kind, canvas: { width: img.width, height: img.height }, palette: pal, targetBox: { width: img.width, height: img.height } } as never);
  console.log(name, `${img.width}x${img.height}`, gate.ok ? "gate ok" : gate.failed, gate.warnings, `orphans ${orphans(img)}`);
}
