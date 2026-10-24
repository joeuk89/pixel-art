// PROTOTYPE, throwaway: wayfinder #68. Ramp lighting over the penthouse, on top of the real v1 compositor.
import { elementRecordSchema, paletteSchema, scenePlanSchema, type ScenePlan } from "../../schema/index.ts";
import { createCompositor, placedXs, type ElementPixels, type Pixels } from "../../viewer/compositor.ts";
import { createPrimitives } from "../../viewer/primitives.ts";

const W = 192, H = 120;
const SCENE = "penthouse-rain-city-night-1x66";
const root = new URL("../../", location.href);

const MIN = -4, MAX = 3, N = MAX - MIN + 1;
const TINT_NONE = 0, TINT_WARM = 1, TINT_COOL = 2;
const NO_INDEX = 255;

const VARIANTS = [
  { key: "A", name: "v1 as shipped (glow Primitive)" },
  { key: "B", name: "Ramp lighting, hard steps" },
  { key: "C", name: "Ramp lighting, Bayer dither" },
  { key: "D", name: "Ramp lighting + smooth halo" },
] as const;
type Mode = "hard" | "dither" | "halo";
const modeOf: Record<string, Mode> = { B: "hard", C: "dither", D: "halo" };

const params = {
  ramps: "hand" as "hand" | "auto",
  roomAmbient: -1,
  farPlanes: -1,
  lamp: 3,
  lampRadius: 90,
  falloff: "linear" as "linear" | "quadratic",
  city: 1,
  flicker: 0.15,
  halo: 0.45,
  overlay: "none" as "none" | "levels" | "emissive",
};

// ---- loading, as viewer/scene.ts does it

async function decode(url: URL): Promise<Pixels> {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}

async function loadElements(plan: ScenePlan): Promise<Map<string, ElementPixels>> {
  const ids = new Set(plan.layers.flatMap((l) => (l.placements ?? []).map((p) => p.element)));
  return new Map(
    await Promise.all(
      [...ids].map(async (id): Promise<[string, ElementPixels]> => {
        const base = new URL(`library/elements/${id}`, root);
        const record = elementRecordSchema.parse(await (await fetch(`${base.href}.json`)).json());
        const still = await decode(new URL(`${base.href}.png`));
        if (record.kind !== "prop" || !record.animation) return [id, { still }];
        const { frames, fps, order } = record.animation;
        return [id, { still, strip: { image: await decode(new URL(`${base.href}.strip.png`)), frames, fps, order } }];
      }),
    ),
  );
}

const plan = scenePlanSchema.parse(await (await fetch(new URL(`scenes/${SCENE}/scene.json`, root))).json());
const palette = paletteSchema.parse(await (await fetch(new URL(`library/palettes/${plan.palette}.json`, root))).json());
const elements = await loadElements(plan);

const withGlow = createCompositor({ plan, elements, palette, primitives: createPrimitives({ plan, elements, palette }) });
const allPrimitives = createPrimitives({ plan, elements, palette });
const unlit = createCompositor({
  plan,
  elements,
  palette,
  primitives: allPrimitives.filter((_, i) => plan.primitives?.[i]?.type !== "glow"),
});

// ---- Palette: rgb, Oklab, little-endian RGBA words

const K = palette.colours.length;
const rgb = palette.colours.map((h) => parseInt(h.slice(1), 16));
const rgba32 = new Uint32Array(rgb.map((v) => (0xff << 24) | ((v & 255) << 16) | (((v >> 8) & 255) << 8) | (v >> 16)));
const indexOfRgb = new Map(rgb.map((v, i) => [v, i] as const).reverse());

function oklab(v: number): [number, number, number] {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const r = lin(v >> 16), g = lin((v >> 8) & 255), b = lin(v & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const lab = rgb.map(oklab);
const nearestLab = (p: number[]) => {
  let best = 0, bestD = Infinity;
  lab.forEach((q, i) => {
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
    if (d < bestD) (bestD = d), (best = i);
  });
  return best;
};

// ---- ramps: lut[(tint * K + colour) * N + level - MIN] = Palette index

// cosy-night's four ramps, darkest first, with shared dark ends; 15 (pale grey) caps the violet ramp.
const CHAINS = [[0, 1, 2, 3, 15], [0, 4, 5, 6, 7], [0, 11, 10, 9, 8], [0, 1, 14, 13, 12]];
const WARM_LIGHT = 8, COOL_LIGHT = 6;

function handLut(): Uint8Array {
  const lut = new Uint8Array(3 * K * N);
  for (let c = 0; c < K; c++) {
    const chain = CHAINS.find((ch) => ch.indexOf(c) > 0) ?? CHAINS[0];
    const pos = chain.indexOf(c);
    for (let t = 0; t < 3; t++)
      for (let l = MIN; l <= MAX; l++) lut[(t * K + c) * N + l - MIN] = chain[Math.max(0, Math.min(chain.length - 1, pos + l))];
  }
  return lut;
}

function autoLut(): Uint8Array {
  const lut = new Uint8Array(3 * K * N);
  const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  for (let c = 0; c < K; c++)
    for (let t = 0; t < 3; t++)
      for (let l = MIN; l <= MAX; l++) {
        let p = lab[c];
        if (l < 0) p = lerp(lab[c], lab[0], Math.min(1, -l * 0.24));
        if (l > 0) {
          const light = lab[t === TINT_COOL ? COOL_LIGHT : WARM_LIGHT];
          p = lerp(lab[c], light, Math.min(1, l * 0.22));
          p[0] += l * 0.04;
        }
        lut[(t * K + c) * N + l - MIN] = l === 0 ? c : nearestLab(p);
      }
  return lut;
}
const LUTS = { hand: handLut(), auto: autoLut() };

// ---- static maps: which Layer owns each pixel, which pixels glow by themselves

const layerIndex = (name: string) => plan.layers.findIndex((l) => l.name === name);
const SKY = layerIndex("sky"), CITY = layerIndex("city");
const isFar = (li: number) => li === SKY || li === CITY;
const layerOf = new Uint8Array(W * H);
const shadeEmissive = new Uint8Array(W * H);
const lampPlacement = plan.layers.flatMap((l) => l.placements ?? []).find((p) => p.id === "lamp")!;
const SHADE_ROWS = [8, 20];
const LAMP = { x: lampPlacement.x + 12, y: lampPlacement.y + 21 };

plan.layers.forEach((layer, li) => {
  if (layer.fill !== undefined) layerOf.fill(li);
  for (const p of layer.placements ?? []) {
    const px = elements.get(p.element)!.still;
    for (const x0 of placedXs(p, px.width))
      for (let sy = 0; sy < px.height; sy++)
        for (let sx = 0; sx < px.width; sx++) {
          const x = x0 + sx, y = p.y + sy;
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          const s = (sy * px.width + sx) * 4;
          if (px.data[s + 3] < 128) continue;
          layerOf[y * W + x] = li;
          const c = indexOfRgb.get((px.data[s] << 16) | (px.data[s + 1] << 8) | px.data[s + 2]);
          shadeEmissive[y * W + x] = p === lampPlacement && sy >= SHADE_ROWS[0] && sy <= SHADE_ROWS[1] && (c === 12 || c === 13 || c === 14) ? 1 : 0;
        }
  }
});
const CITY_EMISSIVE = new Set([8, 9, 12]);

// ---- slow lamp flicker, stepped at 10 fps like the glow Primitive

const hash = (k: number) => {
  let h = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const noise = (t: number) => {
  const k = Math.floor(t), f = t - k, s = f * f * (3 - 2 * f);
  return hash(k) * (1 - s) + hash(k + 1) * s;
};
const flickerAt = (ms: number) => {
  const t = Math.floor(ms / 100) / 10;
  return 1 - params.flicker * (0.75 * noise(t / 1.4) + 0.25 * noise(t * 3 + 99));
};

// ---- the pass: one loop builds the light level and looks the colour up on its ramp

type Planes = { w: number; h: number; s: number; idx: Uint8Array; layer: Uint8Array; emissive: Uint8Array; out: Uint32Array; level: Float32Array; tint: Uint8Array };
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const WARM_RGB = [0xf7, 0xd3, 0x5c];

function light(pl: Planes, mode: Mode, flick: number): void {
  const { w, h, s, idx, layer, emissive, out, level, tint } = pl;
  const lut = LUTS[params.ramps];
  const lx = LAMP.x * s, ly = LAMP.y * s, r2 = (params.lampRadius * s) ** 2;
  const lampPeak = params.lamp * flick;
  const shadeLevel = flick < 0.88 ? -1 : 0;
  const quadratic = params.falloff === "quadratic";
  for (let y = 0; y < h; y++) {
    const yy = y / s;
    const city = params.city * Math.exp(-(((yy - 100) / 28) ** 2));
    const dy2 = (y - ly) ** 2;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = idx[i];
      if (c === NO_INDEX) continue;
      let f: number, t = TINT_NONE;
      if (emissive[i]) f = emissive[i] === 2 ? shadeLevel : 0;
      else if (isFar(layer[i])) f = params.farPlanes;
      else {
        const d2 = (x - lx) ** 2 + dy2;
        const k = d2 >= r2 ? 0 : 1 - Math.sqrt(d2 / r2);
        const lamp = lampPeak * (quadratic ? k * k : k);
        f = params.roomAmbient + lamp + city;
        if (lamp + city > 0.05) t = lamp >= city ? TINT_WARM : TINT_COOL;
      }
      let L = mode === "dither" ? Math.floor(f + BAYER[((y & 3) << 2) | (x & 3)]) : Math.round(f);
      L = L < MIN ? MIN : L > MAX ? MAX : L;
      level[i] = f;
      tint[i] = t;
      out[i] = rgba32[lut[(t * K + c) * N + L - MIN]];
    }
  }
  if (mode !== "halo") return;
  const hy = (LAMP.y - 7) * s, hr = 40 * s, a0 = params.halo * flick;
  const bytes = new Uint8ClampedArray(out.buffer);
  for (let y = Math.max(0, hy - hr); y < Math.min(h, hy + hr); y++)
    for (let x = Math.max(0, lx - hr); x < Math.min(w, lx + hr); x++) {
      const d = Math.hypot(x - lx, y - hy) / hr;
      if (d >= 1) continue;
      const a = a0 * (1 - d) ** 2, o = (y * w + x) * 4;
      bytes[o] += WARM_RGB[0] * a;
      bytes[o + 1] += WARM_RGB[1] * a;
      bytes[o + 2] += WARM_RGB[2] * a;
    }
}

function planes(s: number): Planes {
  const w = W * s, h = H * s, n = w * h;
  return { w, h, s, idx: new Uint8Array(n), layer: new Uint8Array(n), emissive: new Uint8Array(n), out: new Uint32Array(n), level: new Float32Array(n), tint: new Uint8Array(n) };
}
const p1 = planes(1), p2 = planes(2);
p1.layer.set(layerOf);

// The real compositor writes RGBA, so the prototype recovers indices; a v2 compositor would keep the index plane as it draws.
function indexFrame(frame: Uint8ClampedArray): void {
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const c = indexOfRgb.get((frame[o] << 16) | (frame[o + 1] << 8) | frame[o + 2]) ?? NO_INDEX;
    p1.idx[i] = c;
    p1.emissive[i] = shadeEmissive[i] ? 2 : layerOf[i] === CITY && CITY_EMISSIVE.has(c) ? 1 : 0;
  }
}

function upscale(): void {
  for (let y = 0; y < H * 2; y++)
    for (let x = 0; x < W * 2; x++) {
      const i = y * W * 2 + x, j = (y >> 1) * W + (x >> 1);
      p2.idx[i] = p1.idx[j];
      p2.layer[i] = p1.layer[j];
      p2.emissive[i] = p1.emissive[j];
    }
}

// ---- overlays

function overlay(out: Uint32Array): void {
  for (let i = 0; i < W * H; i++) {
    if (params.overlay === "emissive") {
      if (p1.emissive[i]) out[i] = 0xffff00ff;
      continue;
    }
    const f = p1.level[i], v = Math.max(0, Math.min(255, Math.round(((f - MIN) / (MAX - MIN)) * 255)));
    const t = p1.tint[i];
    const [r, g, b] = p1.emissive[i] ? [255, 0, 255] : t === TINT_WARM ? [v, v * 0.75, v * 0.3] : t === TINT_COOL ? [v * 0.4, v * 0.7, v] : [v, v, v];
    out[i] = (0xff << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r);
  }
}

// ---- UI

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const ctx = canvas.getContext("2d", { alpha: false })!;
const image = new ImageData(W, H);
const image32 = new Uint32Array(image.data.buffer);
const stage = document.querySelector<HTMLElement>("#stage")!;
const panel = document.querySelector<HTMLElement>("#panel")!;

let variant = new URLSearchParams(location.search).get("variant") ?? "B";
if (!VARIANTS.some((v) => v.key === variant)) variant = "B";

function fit() {
  const dpr = devicePixelRatio || 1;
  const scale = Math.max(1, Math.floor(Math.min((stage.clientWidth * dpr) / W, (stage.clientHeight * dpr) / H)));
  canvas.style.width = `${(scale * W) / dpr}px`;
  canvas.style.height = `${(scale * H) / dpr}px`;
}
addEventListener("resize", fit);
document.addEventListener("fullscreenchange", () => {
  document.body.classList.toggle("bare", !!document.fullscreenElement);
  fit();
});

function setVariant(key: string) {
  variant = key;
  const url = new URL(location.href);
  url.searchParams.set("variant", key);
  history.replaceState(null, "", url);
  const v = VARIANTS.find((x) => x.key === key)!;
  document.querySelector("#label")!.textContent = `${v.key} (${v.name})`;
  renderRamps();
}
const cycle = (d: number) => setVariant(VARIANTS[(VARIANTS.findIndex((v) => v.key === variant) + d + VARIANTS.length) % VARIANTS.length].key);
document.querySelector("#prev")!.addEventListener("click", () => cycle(-1));
document.querySelector("#next")!.addEventListener("click", () => cycle(1));
addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).matches("input, textarea, [contenteditable]")) return;
  if (e.key === "ArrowLeft") cycle(-1);
  if (e.key === "ArrowRight") cycle(1);
  if (e.key === "f") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  if (e.key === "h") {
    document.body.classList.toggle("bare");
    fit();
  }
});

const slider = (key: keyof typeof params, label: string, min: number, max: number, stepBy: number) => `
  <label>${label}<input type="range" data-k="${key}" min="${min}" max="${max}" step="${stepBy}" value="${params[key]}"><span data-v="${key}">${params[key]}</span></label>`;
const choice = (key: keyof typeof params, label: string, options: string[]) => `
  <label>${label}<select data-k="${key}">${options.map((o) => `<option ${o === params[key] ? "selected" : ""}>${o}</option>`).join("")}</select></label>`;

panel.innerHTML = `
  <pre>PROTOTYPE, wayfinder #68. F fullscreen, H hide panel, arrows switch variant.</pre>
  <h2>Ramps</h2>
  ${choice("ramps", "Ramps", ["hand", "auto"])}
  <div id="ramps"></div>
  <h2>Lights</h2>
  ${slider("roomAmbient", "Room ambient", -3, 1, 0.25)}
  ${slider("farPlanes", "Far planes", -3, 1, 0.25)}
  ${slider("lamp", "Lamp peak", 0, 5, 0.25)}
  ${slider("lampRadius", "Lamp radius", 20, 160, 2)}
  ${choice("falloff", "Lamp falloff", ["linear", "quadratic"])}
  ${slider("city", "City glow", 0, 3, 0.25)}
  ${slider("flicker", "Flicker depth", 0, 0.5, 0.01)}
  ${slider("halo", "Halo (D only)", 0, 1, 0.05)}
  ${choice("overlay", "Overlay", ["none", "levels", "emissive"])}
  <h2>Cost</h2>
  <button id="bench">Benchmark the pass (300 frames each)</button>
  <pre id="benchOut"></pre>
  <h2>State</h2>
  <pre id="state"></pre>`;
panel.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  const k = el.dataset.k as keyof typeof params;
  if (!k) return;
  (params as Record<string, unknown>)[k] = el instanceof HTMLInputElement ? Number(el.value) : el.value;
  const out = panel.querySelector(`[data-v="${k}"]`);
  if (out) out.textContent = el.value;
  if (k === "ramps") renderRamps();
});

const hex = (i: number) => palette.colours[i];
function renderRamps() {
  const lut = LUTS[params.ramps];
  const table = (t: number, title: string) => {
    const head = `<tr><th>${title}</th>${Array.from({ length: N }, (_, j) => `<th>${j + MIN}</th>`).join("")}</tr>`;
    const rows = Array.from({ length: K }, (_, c) => {
      const cells = Array.from({ length: N }, (_, j) => {
        const v = lut[(t * K + c) * N + j];
        return `<td class="${j + MIN === 0 ? "base" : ""}" style="background:${hex(v)}" title="${c} → ${v}"></td>`;
      }).join("");
      return `<tr><th>${c}</th>${cells}</tr>`;
    }).join("");
    return `<table class="ramps">${head}${rows}</table>`;
  };
  panel.querySelector("#ramps")!.innerHTML = `<div style="display:flex;gap:12px">${table(TINT_WARM, "warm")}${table(TINT_COOL, "cool")}</div>`;
}

document.querySelector("#bench")!.addEventListener("click", () => {
  const frame = unlit.render(performance.now());
  indexFrame(frame);
  upscale();
  const time = (fn: () => void, n = 300) => {
    for (let i = 0; i < 30; i++) fn();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) fn();
    return (performance.now() - t0) / n;
  };
  const lines = (["hard", "dither", "halo"] as Mode[]).map((m) => `${m.padEnd(7)} 192x120 ${time(() => light(p1, m, 0.9)).toFixed(3)} ms   384x240 ${time(() => light(p2, m, 0.9)).toFixed(3)} ms`);
  lines.push(`index recovery (prototype only) ${time(() => indexFrame(frame)).toFixed(3)} ms`);
  lines.push(`v1 compositor render() ${time(() => unlit.render(performance.now())).toFixed(3)} ms`);
  panel.querySelector("#benchOut")!.textContent = lines.join("\n");
});

// ---- loop: 24 fps, the rain's rate

const stats = { frames: 0, lightMs: 0, renderMs: 0 };
let last = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  if (now - last < 1000 / 24) return;
  last = now;
  const flick = flickerAt(now);
  const t0 = performance.now();
  if (variant === "A") {
    image.data.set(withGlow.render(now));
  } else {
    const f = unlit.render(now);
    const t1 = performance.now();
    indexFrame(f);
    const t2 = performance.now();
    light(p1, modeOf[variant], flick);
    stats.lightMs += performance.now() - t2;
    stats.renderMs += t1 - t0;
    image32.set(p1.out);
    for (let i = 0; i < W * H; i++) if (p1.idx[i] === NO_INDEX) image32[i] = (0xff << 24) | (f[i * 4 + 2] << 16) | (f[i * 4 + 1] << 8) | f[i * 4];
    if (params.overlay !== "none") overlay(image32);
  }
  ctx.putImageData(image, 0, 0);
  if (++stats.frames % 48 === 0) {
    panel.querySelector("#state")!.textContent = [
      `variant ${variant}  ramps ${params.ramps}`,
      `flicker ${flick.toFixed(3)}`,
      `lighting pass (live avg, 192x120) ${(stats.lightMs / 48).toFixed(3)} ms`,
      `compositor render (live avg) ${(stats.renderMs / 48).toFixed(3)} ms`,
      `unmatched pixels ${p1.idx.reduce((n, c) => n + (c === NO_INDEX ? 1 : 0), 0)}`,
      JSON.stringify(params, null, 1),
    ].join("\n");
    stats.lightMs = stats.renderMs = 0;
  }
}

fit();
setVariant(variant);
requestAnimationFrame(frame);
