import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allPlacements, placementsOf, SCENE_HEIGHT, SCENE_WIDTH, scenePlanSchema, type Primitive, type ScenePlan } from "../schema/index.ts";
import { createCompositor, type Compositor } from "../viewer/compositor.ts";
import { createPrimitives, flashTimes, PROP_FPS, WEATHER_FPS } from "../viewer/primitives.ts";
import { loadElementPixels } from "../pipeline/lib/element-pixels.ts";
import { fixturePalette, fixtures } from "./helpers.ts";

const W = SCENE_WIDTH;
const palette = JSON.parse(readFileSync(join(fixtures, `library/palettes/${fixturePalette}.json`), "utf8"));
const paletteRgb = new Set<number>(palette.colours.map((hex: string) => parseInt(hex.slice(1), 16)));
const catalogue: ScenePlan = scenePlanSchema.parse(JSON.parse(readFileSync(join(fixtures, "primitives/scene.json"), "utf8")));
const elements = await loadElementPixels(fixtures, catalogue);
const TYPES = ["rain", "snow", "steam", "twinkle", "blink", "dust", "sway", "birds", "pendulum", "boats", "trickle", "flash", "garland"] as const;
const TIMES = Array.from({ length: 60 }, (_, k) => k * 137);

function only(type: string): Primitive[] {
  return catalogue.primitives.filter((p) => p.type === type);
}

function scene(primitives: Primitive[], seed = catalogue.seed): Compositor {
  const plan = { ...catalogue, seed, primitives };
  return createCompositor({ plan, elements, palette, primitives: createPrimitives({ plan, elements, palette }) });
}

const bare = createCompositor({ plan: catalogue, elements, palette });

function effectOf(primitives: Primitive[], seed: number): (t: number) => Buffer {
  const withPrimitives = scene(primitives, seed);
  const without = createCompositor({ plan: { ...catalogue, seed }, elements, palette });
  return (t) => {
    const a = withPrimitives.render(t);
    const b = without.render(t);
    const changed = Buffer.alloc(a.length);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed[i] = a[i];
    return changed;
  };
}

function offPalette(out: Uint8ClampedArray): string | undefined {
  for (let i = 0; i < out.length; i += 4) {
    const rgb = (out[i] << 16) | (out[i + 1] << 8) | out[i + 2];
    if (!paletteRgb.has(rgb) || out[i + 3] !== 255) return `pixel ${(i / 4) % W},${Math.floor(i / 4 / W)} is #${rgb.toString(16).padStart(6, "0")}`;
  }
}

test("the fixture Scene without Primitives is all Palette colours", () => {
  assert.equal(offPalette(bare.render(0)), undefined);
});

for (const type of TYPES) {
  test(`${type} renders from the fixture plan and emits only Palette colours`, () => {
    const c = scene(only(type));
    let changed = 0;
    for (const t of TIMES) {
      const out = c.render(t);
      assert.equal(offPalette(out), undefined, `${type} at ${t} ms`);
      if (!Buffer.from(out).equals(Buffer.from(bare.render(t)))) changed++;
    }
    assert.ok(changed > 0, `${type} never changed a pixel`);
  });
}

test("the same seed and time give byte-identical frames from two compositors, in any render order", () => {
  const a = scene(catalogue.primitives);
  const b = scene(catalogue.primitives);
  const forward = TIMES.map((t) => Buffer.from(a.render(t)));
  const backward = [...TIMES].reverse().map((t) => Buffer.from(b.render(t))).reverse();
  forward.forEach((frame, k) => assert.ok(frame.equals(backward[k]), `frames differ at ${TIMES[k]} ms`));
  assert.ok(Buffer.from(scene(catalogue.primitives).render(3_600_000)).equals(Buffer.from(scene(catalogue.primitives).render(3_600_000))));
});

for (const type of TYPES) {
  test(`${type} draws differently under a different seed`, () => {
    const a = effectOf(only(type), 1);
    const b = effectOf(only(type), 2);
    assert.ok(TIMES.some((t) => !a(t).equals(b(t))), `${type} ignores the seed`);
  });
}

function stillScene(primitives: Primitive[]): Compositor {
  const layers = catalogue.layers.map((layer) =>
    layer.kind === "placements"
      ? { ...layer, placements: placementsOf(layer).map((p) => (p.id === "cat" ? { ...p, animation: { enabled: false } } : p)) }
      : layer,
  );
  const plan = { ...catalogue, layers, primitives };
  return createCompositor({ plan, elements, palette, primitives: createPrimitives({ plan, elements, palette }) });
}

test("the Viewer frame caps are 24 fps for weather and 10 fps for prop Primitives", () => {
  assert.equal(WEATHER_FPS, 24);
  assert.equal(PROP_FPS, 10);
});

for (const type of ["rain", "snow"]) {
  test(`${type} makes a redraw due every 1/24 s and not in between`, () => {
    const c = stillScene(only(type));
    assert.equal(c.tick(0), true);
    c.render(0);
    assert.equal(c.nextTick(0), 1000 / 24);
    assert.equal(c.tick(20), false);
    assert.equal(c.tick(41.6), false);
    assert.equal(c.tick(1000 / 24), true);
    c.render(50);
    assert.equal(c.nextTick(50), 2000 / 24);
    assert.equal(c.tick(80), false);
  });
}

for (const type of ["steam", "dust"]) {
  test(`${type} makes a redraw due every 1/10 s and not in between`, () => {
    const c = stillScene(only(type));
    c.render(0);
    assert.equal(c.nextTick(0), 100);
    assert.equal(c.tick(99), false);
    assert.equal(c.tick(100), true);
  });
}

for (const [type, fps, idles] of [["sway", PROP_FPS, false], ["birds", WEATHER_FPS, true], ["boats", WEATHER_FPS, true], ["trickle", WEATHER_FPS, true]] as const) {
  test(`${type} wakes at ${fps} fps and never skips a step that changes pixels${idles ? ", but skips steps between flights" : ""}`, () => {
    const c = stillScene(only(type));
    const at = (k: number) => (k * 1000) / fps;
    let idle = 0;
    c.render(0);
    for (let k = 1; k <= 600; k++) {
      assert.equal(c.nextTick(at(k - 1)), at(k));
      const before = Buffer.from(c.render(at(k - 1)));
      const tick = c.tick(at(k));
      const changed = !before.equals(Buffer.from(c.render(at(k))));
      if (changed) assert.ok(tick, `step ${k} changed pixels without a tick`);
      if (!tick) idle++;
    }
    if (idles) assert.ok(idle > 0, `${type} never skipped a step`);
  });
}

const windowAt = allPlacements(catalogue).find((p) => p.id === "window")!;
const [twinkleOf, blinkOf, pendulumOf, garlandOf] = [only("twinkle")[0], only("blink")[0], only("pendulum")[0], only("garland")[0]];
const exactCases: [string, Primitive, boolean][] = [
  ["pendulum", pendulumOf, true],
  ["garland", garlandOf, true],
  ["garland with only baubles", { ...garlandOf, strands: [] } as Primitive, false],
  ["blink", blinkOf, true],
  ["twinkle", twinkleOf, true],
  ["twinkle with one light at a time", { ...twinkleOf, count: 1 } as Primitive, true],
  ["twinkle whose anchor has none of its light colours", { ...twinkleOf, colours: [3] } as Primitive, false],
  ["blink whose anchor has none of its from colours", { ...blinkOf, swaps: [[4, 5]] } as Primitive, false],
];

for (const [name, primitive, moves] of exactCases) {
  test(`${name} makes a redraw due at a 1/10 s step exactly when its pixels change`, () => {
    const c = stillScene([primitive]);
    let due = 0;
    let idle = 0;
    c.render(0);
    for (let k = 1; k <= 400; k++) {
      assert.equal(c.nextTick((k - 1) * 100), k * 100);
      const before = Buffer.from(c.render((k - 1) * 100));
      const tick = c.tick(k * 100);
      const changed = !before.equals(Buffer.from(c.render(k * 100)));
      assert.equal(tick, changed, `step ${k}: tick ${tick}, pixels changed ${changed}`);
      if (tick) due++;
      else idle++;
    }
    if (moves) assert.ok(due > 0 && idle > 0, `due ${due}, idle ${idle}`);
    else assert.equal(due, 0);
  });
}

test("a Scene with Primitives of both kinds wakes for whichever clock is next", () => {
  const c = stillScene([...only("rain"), ...only("steam")]);
  c.render(0);
  assert.equal(c.nextTick(0), 1000 / 24);
  c.render(90);
  assert.equal(c.nextTick(90), 100);
  assert.equal(c.tick(99), false);
  assert.equal(c.tick(100), true);
});

function changedPixels(primitives: Primitive[], times = TIMES): Set<number> {
  const c = stillScene(primitives);
  const plain = stillScene([]);
  const changed = new Set<number>();
  for (const t of times) {
    const a = c.render(t);
    const b = plain.render(t);
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) changed.add(i / 4);
  }
  return changed;
}

test("rain stays inside its region and, anchored to the skyline, draws under the window frame", () => {
  const [rain] = only("rain");
  const { region } = rain as Extract<Primitive, { type: "rain" }>;
  const window = elements.get("window-wood-transparent-panes-01")!.still;
  const frameAt = (x: number, y: number) => {
    const sx = x - windowAt.x, sy = y - windowAt.y;
    return sx >= 0 && sy >= 0 && sx < window.width && sy < window.height && window.data[(sy * window.width + sx) * 4 + 3] >= 128;
  };
  const anchored = changedPixels([rain]);
  assert.ok(anchored.size > 0);
  for (const pixel of anchored) {
    const x = pixel % W, y = Math.floor(pixel / W);
    assert.ok(x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h, `rain at ${x},${y} is outside its region`);
    assert.equal(frameAt(x, y), false, `rain at ${x},${y} covers the window frame`);
  }
  const onTop = changedPixels([{ ...rain, anchor: undefined } as Primitive]);
  assert.ok([...onTop].some((pixel) => frameAt(pixel % W, Math.floor(pixel / W))), "unanchored rain draws over every Layer");
});

test("rain with gust 0 draws exactly what rain drew before gusts existed", () => {
  const [rain] = only("rain");
  const c = scene([{ ...rain, gust: 0 } as Primitive]);
  const hash = createHash("sha256");
  for (const t of TIMES) hash.update(c.render(t));
  assert.equal(hash.digest("hex"), "8adef830aad17159bed97bbfac4254822dae05323bef968bac5028c01f7d8b5b");
});

const gusty = { type: "rain", emissive: false, region: { x: 0, y: 0, w: W, h: SCENE_HEIGHT }, colours: [7], density: 1, drift: 0.5, gust: 1, gustPeriod: 6 } as Primitive;

function dropTrack(rain: Primitive, steps: number): ({ x: number; y: number } | undefined)[] {
  const layers = [{ name: "sky", kind: "fill", plane: "far", colour: 1 }] as ScenePlan["layers"];
  const plan = { ...catalogue, layers, primitives: [rain] };
  const c = createCompositor({ plan, elements, palette, primitives: createPrimitives({ plan, elements, palette }) });
  const plain = createCompositor({ plan: { ...plan, primitives: [] }, elements, palette }).render(0);
  return Array.from({ length: steps }, (_, s) => {
    const out = c.render((s * 1000) / WEATHER_FPS);
    let sumX = 0, n = 0, top = Infinity;
    for (let i = 0; i < out.length; i += 4) {
      if (out[i] === plain[i] && out[i + 1] === plain[i + 1] && out[i + 2] === plain[i + 2]) continue;
      sumX += (i / 4) % W;
      top = Math.min(top, Math.floor(i / 4 / W));
      n++;
    }
    return n ? { x: sumX / n, y: top } : undefined;
  });
}

function sidewaysSteps(track: ({ x: number; y: number } | undefined)[]): { step: number; dx: number }[] {
  const moves: { step: number; dx: number }[] = [];
  for (let s = 1; s < track.length; s++) {
    const a = track[s - 1], b = track[s];
    if (a && b && b.y > a.y) moves.push({ step: s, dx: b.x - a.x });
  }
  return moves;
}

test("rain with a gust leans harder at a gust's peak than in a lull, and its drops never jump sideways", () => {
  const moves = sidewaysSteps(dropTrack(gusty, 60 * WEATHER_FPS));
  assert.ok(moves.length > 1000);
  for (const { step, dx } of moves) assert.ok(dx >= 0 && dx <= 0.5 + 1 + 1, `drop moved ${dx} px sideways at step ${step}`);
  const perSecond = new Map<number, number[]>();
  for (const { step, dx } of moves) perSecond.set(Math.floor(step / WEATHER_FPS), [...(perSecond.get(Math.floor(step / WEATHER_FPS)) ?? []), dx]);
  const means = [...perSecond.values()].filter((d) => d.length >= 12).map((d) => d.reduce((a, b) => a + b, 0) / d.length);
  assert.ok(Math.max(...means) - Math.min(...means) > 0.5, `lean only ranges ${Math.min(...means)} to ${Math.max(...means)} px per step`);
  const calm = sidewaysSteps(dropTrack({ ...gusty, gust: 0 } as Primitive, 20 * WEATHER_FPS));
  const calmMean = calm.reduce((a, m) => a + m.dx, 0) / calm.length;
  assert.ok(Math.abs(calmMean - 0.5) < 0.05, `calm rain drifts ${calmMean} px per step`);
});

test("rain with a gust draws byte-identical frames in any render order", () => {
  const rain = { ...gusty, density: 64 } as Primitive;
  const times = Array.from({ length: 80 }, (_, k) => k * 911);
  const forward = times.map((t) => Buffer.from(scene([rain]).render(t)));
  const c = scene([rain]);
  const backward = [...times].reverse().map((t) => Buffer.from(c.render(t))).reverse();
  forward.forEach((frame, k) => assert.ok(frame.equals(backward[k]), `frames differ at ${times[k]} ms`));
});

test("blink swaps only the anchored Placement's from colour, and twinkle only the anchor's light colours", () => {
  const swapped = changedPixels(only("blink"), Array.from({ length: 200 }, (_, k) => k * 100));
  const window = elements.get("window-wood-transparent-panes-01")!.still;
  const wood = palette.colours[10];
  assert.ok(swapped.size > 0);
  for (const pixel of swapped) {
    const sx = (pixel % W) - windowAt.x, sy = Math.floor(pixel / W) - windowAt.y;
    const i = (sy * window.width + sx) * 4;
    const hex = "#" + [...window.data.subarray(i, i + 3)].map((v) => v.toString(16).padStart(2, "0")).join("");
    assert.equal(hex, wood, `blink changed ${sx},${sy} of the window, which is ${hex}`);
  }
  const dimmed = changedPixels(only("twinkle"));
  const plain = stillScene([]).render(0);
  for (const pixel of dimmed) {
    const hex = "#" + [...plain.subarray(pixel * 4, pixel * 4 + 3)].map((v) => v.toString(16).padStart(2, "0")).join("");
    assert.equal(hex, palette.colours[8], `twinkle changed a pixel that is ${hex}, not a light`);
  }
});

function inRegion(pixel: number, region: { x: number; y: number; w: number; h: number }): boolean {
  const x = pixel % W, y = Math.floor(pixel / W);
  return x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h;
}

function hexAt(out: Uint8ClampedArray, pixel: number): string {
  return "#" + [...out.subarray(pixel * 4, pixel * 4 + 3)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

test("dust stays inside its region, paints only its colours, and each mote fades through them", () => {
  const dust = only("dust")[0] as Extract<Primitive, { type: "dust" }>;
  const times = Array.from({ length: 300 }, (_, k) => k * 100);
  const changed = changedPixels([dust], times);
  assert.ok(changed.size > 0);
  const c = stillScene([dust]);
  const seen = new Set<string>();
  for (const t of times) {
    const out = c.render(t);
    for (const pixel of changedPixels([dust], [t])) {
      assert.ok(inRegion(pixel, dust.region), `dust at ${pixel % W},${Math.floor(pixel / W)} is outside its region`);
      seen.add(hexAt(out, pixel));
    }
  }
  assert.deepEqual([...seen].sort(), dust.colours.map((i) => palette.colours[i]).sort());
});

test("sway shifts only the anchor's leaf colours inside its region, by at most its amplitude, on every tiled copy", () => {
  const sway = only("sway")[0] as Extract<Primitive, { type: "sway" }>;
  const leaf = palette.colours[sway.colours[0]];
  const plain = stillScene([]).render(0);
  const c = stillScene([sway]);
  const times = Array.from({ length: 100 }, (_, k) => k * 100);
  const changed = changedPixels([sway], times);
  const tile = elements.get("sky-stars-night-01")!.still.width;
  assert.ok(new Set([...changed].map((p) => Math.floor((p % W) / tile))).size > 1, "sway moved only one tiled copy");
  for (const t of times) {
    const out = c.render(t);
    for (const pixel of changedPixels([sway], [t])) {
      assert.ok(inRegion(pixel, sway.region), `sway changed ${pixel % W},${Math.floor(pixel / W)} outside its region`);
      const now = hexAt(out, pixel), was = hexAt(plain, pixel);
      assert.ok(now === leaf || was === leaf, `sway changed a ${was} pixel to ${now}, and neither is a leaf`);
      const near = [];
      for (let dx = -sway.amplitude; dx <= sway.amplitude; dx++) near.push(hexAt(plain, pixel + dx));
      assert.ok(near.includes(now), `sway moved ${now} further than ${sway.amplitude} px`);
    }
  }
});

test("birds draw nothing at time 0, fly inside their region, and cross it now and then", () => {
  const birds = only("birds")[0] as Extract<Primitive, { type: "birds" }>;
  assert.equal(changedPixels([birds], [0]).size, 0, "birds are in the Poster");
  const times = Array.from({ length: 600 }, (_, k) => k * 50);
  let present = 0;
  for (const t of times) {
    const at = changedPixels([birds], [t]);
    if (at.size > 0) present++;
    for (const pixel of at) assert.ok(inRegion(pixel, birds.region), `a bird at ${pixel % W},${Math.floor(pixel / W)} is outside its region`);
  }
  assert.ok(present > 0 && present < times.length, `birds were present at ${present} of ${times.length} times`);
});

test("pendulum swings a straight rod and its bob about the pivot, inside its region, in its colours, once per period", () => {
  const pendulum = pendulumOf as Extract<Primitive, { type: "pendulum" }>;
  const [rod, ...bob] = pendulum.colours.map((i) => palette.colours[i]);
  const { pivot, length, amplitude, period } = pendulum;
  const reach = length * Math.sin((amplitude * Math.PI) / 180);
  const c = stillScene([pendulum]);
  const times = Array.from({ length: period * PROP_FPS }, (_, k) => k * 100);
  const leans: number[] = [];
  for (const t of times) {
    const out = c.render(t);
    const rods: number[] = [], bobs: number[] = [];
    for (const pixel of changedPixels([pendulum], [t])) {
      assert.ok(inRegion(pixel, pendulum.region), `pendulum at ${pixel % W},${Math.floor(pixel / W)} is outside its region`);
      const hex = hexAt(out, pixel);
      assert.ok(hex === rod || bob.includes(hex), `pendulum painted ${hex}, not one of its colours`);
      (hex === rod ? rods : bobs).push(pixel);
    }
    assert.ok(rods.length > 0 && bobs.length > 0, `no rod or bob at ${t} ms`);
    const bx = bobs.reduce((a, p) => a + (p % W), 0) / bobs.length;
    const by = bobs.reduce((a, p) => a + Math.floor(p / W), 0) / bobs.length;
    assert.ok(Math.abs(Math.hypot(bx - pivot.x, by - pivot.y) - length) <= 1.5, `bob at ${bx},${by} is not ${length} px from the pivot`);
    for (const pixel of rods) {
      const x = pixel % W, y = Math.floor(pixel / W);
      const along = ((x - pivot.x) * (bx - pivot.x) + (y - pivot.y) * (by - pivot.y)) / (length * length);
      const off = Math.abs((x - pivot.x) * (by - pivot.y) - (y - pivot.y) * (bx - pivot.x)) / Math.hypot(bx - pivot.x, by - pivot.y);
      assert.ok(along >= -0.05 && along <= 1.05 && off <= 1, `rod pixel ${x},${y} bends off the line from the pivot to the bob`);
    }
    leans.push(bx - pivot.x);
    assert.ok(Buffer.from(out).equals(Buffer.from(c.render(t + period * 1000))), `the swing does not repeat after ${period} s`);
  }
  assert.ok(Math.min(...leans) <= -reach + 1 && Math.max(...leans) >= reach - 1, `bob leaned only ${Math.min(...leans)} to ${Math.max(...leans)} px`);
  assert.ok(leans.every((lean) => Math.abs(lean) <= reach + 1), "bob swung past its amplitude");
});

test("boats draw nothing at time 0, drift inside their region as a hull with one light at an end, and enter from its edge", () => {
  const boats = only("boats")[0] as Extract<Primitive, { type: "boats" }>;
  const { region } = boats;
  const [hull, light] = boats.colours.map((i) => palette.colours[i]);
  assert.equal(changedPixels([boats], [0]).size, 0, "boats are in the Poster");
  const c = stillScene([boats]);
  const times = Array.from({ length: 480 }, (_, k) => k * 250);
  let previous = new Map<number, { min: number; max: number }>();
  let seen = 0;
  for (const t of times) {
    const out = c.render(t);
    const rows = new Map<number, number[]>();
    for (const pixel of changedPixels([boats], [t])) {
      const x = pixel % W, y = Math.floor(pixel / W);
      assert.ok(inRegion(pixel, region), `a boat at ${x},${y} is outside its region`);
      const hex = hexAt(out, pixel);
      assert.ok(hex === hull || hex === light, `a boat painted ${hex}, not its hull or light`);
      rows.set(y, [...(rows.get(y) ?? []), x]);
    }
    const now = new Map<number, { min: number; max: number }>();
    for (const [y, xs] of rows) {
      const min = Math.min(...xs), max = Math.max(...xs);
      assert.equal(xs.length, max - min + 1, `the boat on row ${y} at ${t} ms is broken up`);
      assert.ok(xs.length <= 6, `the boat on row ${y} at ${t} ms is ${xs.length} px long`);
      const lights = xs.filter((x) => hexAt(out, y * W + x) === light);
      assert.ok(lights.length <= 1, `the boat on row ${y} at ${t} ms has ${lights.length} lights`);
      if (lights.length === 1) assert.ok(lights[0] === min || lights[0] === max, `the light on row ${y} at ${t} ms is not at an end`);
      const before = previous.get(y);
      if (before) assert.ok(Math.abs(before.min - min) <= 1 && Math.abs(before.max - max) <= 1, `the boat on row ${y} jumped at ${t} ms`);
      else assert.ok(min === region.x || max === region.x + region.w - 1, `a boat appeared mid-river on row ${y} at ${t} ms`);
      now.set(y, { min, max });
      seen++;
    }
    previous = now;
  }
  assert.ok(seen > 0, "no boat ever sailed");
});

test("trickle draws nothing at time 0, and its beads sit mostly still inside the region, slide only downward, leave through the bottom and leave trails that dry", () => {
  const trickle = only("trickle")[0] as Extract<Primitive, { type: "trickle" }>;
  const { region } = trickle;
  const hexes = trickle.colours.map((i) => palette.colours[i]);
  const bead = hexes[hexes.length - 1];
  assert.equal(changedPixels([trickle], [0]).size, 0, "beads are in the Poster");
  const c = stillScene([trickle]);
  const plain = stillScene([]).render(0);
  const steps = 24 * 90;
  const at = (k: number) => (k * 1000) / WEATHER_FPS;
  let previous = new Map<number, string>();
  const wetSince = new Map<number, number>();
  let stayed = 0, beads = 0, bottom = 0;
  for (let k = 0; k <= steps; k++) {
    const out = c.render(at(k));
    const now = new Map<number, string>();
    for (let i = 0; i < out.length; i += 4) {
      if (out[i] === plain[i] && out[i + 1] === plain[i + 1] && out[i + 2] === plain[i + 2]) continue;
      const pixel = i / 4, hex = hexAt(out, pixel);
      const x = pixel % W, y = Math.floor(pixel / W);
      assert.ok(inRegion(pixel, region), `trickle at ${x},${y} is outside its region`);
      assert.ok(hexes.includes(hex), `trickle painted ${hex}, not one of its colours`);
      now.set(pixel, hex);
    }
    for (const [pixel, hex] of now) {
      const x = pixel % W, y = Math.floor(pixel / W);
      if (hex === bead) {
        beads++;
        if (previous.get(pixel) === bead) stayed++;
        else if (!previous.has(pixel)) {
          const above = [-1, 0, 1].some((dx) => previous.has(pixel - W + dx));
          assert.ok(above, `a bead appeared at ${x},${y} at step ${k} without forming or sliding down from above`);
        }
        if (y === region.y + region.h - 1) bottom++;
        wetSince.delete(pixel);
      } else {
        if (!wetSince.has(pixel)) wetSince.set(pixel, k);
        assert.ok(k - wetSince.get(pixel)! <= WEATHER_FPS * 2, `${x},${y} stayed a trail or forming bead for over 2 s at step ${k}`);
      }
    }
    for (const pixel of wetSince.keys()) if (!now.has(pixel) || now.get(pixel) === bead) wetSince.delete(pixel);
    previous = now;
  }
  assert.ok(beads > 0, "no bead ever formed");
  assert.ok(stayed / beads > 0.8, `only ${Math.round((100 * stayed) / beads)}% of bead pixels held still from one step to the next`);
  assert.ok(bottom > 0, "no bead ever reached the bottom edge");
});

test("flash is calm until its shortest wait, then lifts only the anchor's pixels in its region up their cool Ramp, all alike, in flickers of more than one pulse that open at full steps", () => {
  const flash = only("flash")[0] as Extract<Primitive, { type: "flash" }>;
  const { region, steps } = flash;
  const [min, max] = flash.every;
  const at = (k: number) => (k * 1000) / WEATHER_FPS;
  const plain = stillScene([]).render(0);
  const skyline = allPlacements(catalogue).find((p) => p.id === "skyline")!;
  const sky = elements.get(skyline.element)!.still;
  const lifted = (hex: string, lift = 1) => {
    let i = palette.colours.indexOf(hex);
    for (let s = 0; s < lift; s++) i = palette.ramps[i].cool;
    return palette.colours[i];
  };
  const expected = new Set<number>();
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const sx = x - skyline.x!, sy = y - skyline.y!;
      if (sx < 0 || sy < 0 || sx >= sky.width || sy >= sky.height || sky.data[(sy * sky.width + sx) * 4 + 3] < 128) continue;
      const pixel = y * W + x;
      const own = hexAt(sky.data, sy * sky.width + sx);
      if (hexAt(plain, pixel) === own && lifted(own) !== own) expected.add(pixel);
    }
  }
  assert.ok(expected.size > 0);
  const c = stillScene([flash]);
  const lifts: number[] = [];
  for (let k = 0; k <= 30 * WEATHER_FPS; k++) {
    const out = c.render(at(k));
    let changed = 0, lift = 0;
    for (let pixel = 0; pixel < W * SCENE_HEIGHT; pixel++) {
      const i = pixel * 4;
      if (out[i] === plain[i] && out[i + 1] === plain[i + 1] && out[i + 2] === plain[i + 2]) continue;
      assert.ok(expected.has(pixel), `flash changed ${pixel % W},${Math.floor(pixel / W)}, which is not the anchor's inside its region`);
      if (!lift) for (let n = 1; n <= steps && !lift; n++) if (hexAt(out, pixel) === lifted(hexAt(plain, pixel), n)) lift = n;
      assert.ok(lift > 0, `flash did not lift ${pixel % W},${Math.floor(pixel / W)} 1 to ${steps} steps up its Ramp`);
      assert.equal(hexAt(out, pixel), lifted(hexAt(plain, pixel), lift), `flash lifted ${pixel % W},${Math.floor(pixel / W)} unlike the rest of step ${k}`);
      changed++;
    }
    assert.ok(changed === 0 || changed === expected.size, `step ${k} lit ${changed} of ${expected.size} pixels`);
    if (k < min * WEATHER_FPS) assert.equal(changed, 0, `flash lit at step ${k}, before its shortest wait`);
    lifts.push(lift);
  }
  const flashes: { start: number; end: number; pulses: number }[] = [];
  lifts.forEach((on, k) => {
    if (!on) return;
    const last = flashes[flashes.length - 1];
    if (last && k - last.end <= 4) {
      if (k - last.end > 1) last.pulses++;
      last.end = k;
    } else flashes.push({ start: k, end: k, pulses: 1 });
  });
  assert.ok(flashes.length >= 3, `only ${flashes.length} flashes in 30 s`);
  for (const [n, f] of flashes.entries()) {
    assert.ok(f.pulses >= 2, `flash ${n} at step ${f.start} is a single pulse, not a flicker`);
    assert.equal(lifts[f.start], steps, `flash ${n} opened ${lifts[f.start]} steps up, not ${steps}`);
    assert.ok(f.end - f.start < WEATHER_FPS, `flash ${n} lasted ${f.end - f.start + 1} steps`);
    if (n === 0) continue;
    const gap = f.start - flashes[n - 1].start;
    assert.ok(gap >= min * WEATHER_FPS - 1 && gap <= max * WEATHER_FPS + 1, `flash ${n} came ${gap} steps after the one before`);
  }
});

test("flashTimes gives the start of every flash the flash Primitive draws, under the salt of its place in the plan", () => {
  const flash = only("flash")[0] as Extract<Primitive, { type: "flash" }>;
  const dark = { ...flash, region: { x: 0, y: 200, w: 40, h: 40 } };
  const c = stillScene([dark, flash]);
  const plain = Buffer.from(stillScene([]).render(0));
  const starts = flashTimes(catalogue.seed, 1, flash.every);
  for (let n = 0; n < 8; n++) {
    const start = starts.next().value;
    assert.ok(!plain.equals(Buffer.from(c.render(start * 1000))), `flash ${n} is not lit at its start, ${start} s`);
    assert.ok(plain.equals(Buffer.from(c.render(start * 1000 - 1000 / WEATHER_FPS))), `flash ${n} is lit a step before its start, ${start} s`);
  }
});

test("flash makes a redraw due at a 1/24 s step exactly when its pixels change, and never when its region misses the anchor", () => {
  const flash = only("flash")[0] as Extract<Primitive, { type: "flash" }>;
  for (const [primitive, moves] of [[flash, true], [{ ...flash, region: { x: 0, y: 200, w: 40, h: 40 } }, false]] as const) {
    const c = stillScene([primitive]);
    const at = (k: number) => (k * 1000) / WEATHER_FPS;
    let due = 0, idle = 0;
    c.render(0);
    for (let k = 1; k <= 600; k++) {
      assert.equal(c.nextTick(at(k - 1)), at(k));
      const before = Buffer.from(c.render(at(k - 1)));
      const tick = c.tick(at(k));
      const changed = !before.equals(Buffer.from(c.render(at(k))));
      assert.equal(tick, changed, `step ${k}: tick ${tick}, pixels changed ${changed}`);
      if (tick) due++;
      else idle++;
    }
    if (moves) assert.ok(due > 0 && idle > 0, `due ${due}, idle ${idle}`);
    else assert.equal(due, 0);
  }
});

type Garland = Extract<Primitive, { type: "garland" }>;

function garlandScene(garland: Garland): { at: (t: number) => Map<number, string> } {
  const room = catalogue.layers[3] as Extract<ScenePlan["layers"][number], { kind: "placements" }>;
  const layers = [catalogue.layers[0], { ...room, placements: room.placements.filter((p) => p.id === "window") }] as ScenePlan["layers"];
  const plan = { ...catalogue, layers, primitives: [garland as Primitive] };
  const c = createCompositor({ plan, elements, palette, primitives: createPrimitives({ plan, elements, palette }) });
  const plain = createCompositor({ plan: { ...plan, primitives: [] }, elements, palette }).render(0);
  return {
    at(t) {
      const out = c.render(t);
      const changed = new Map<number, string>();
      for (let i = 0; i < out.length; i += 4) if (out[i] !== plain[i] || out[i + 1] !== plain[i + 1] || out[i + 2] !== plain[i + 2]) changed.set(i / 4, hexAt(out, i / 4));
      return changed;
    },
  };
}

const openSky = { ...garlandOf, region: { x: 0, y: 100, w: 110, h: 60 }, wire: undefined, baubles: [] } as Garland;

test("garland hangs bulbs every spacing px along a strand, cycling its colours, and dims only a few at a time, each one step down its own Ramp, never all at once", () => {
  const darkOf = (i: number) => palette.ramps[i].dark;
  const garland = { ...openSky, strands: [[{ x: 10, y: 110 }, { x: 90, y: 110 }]], sag: 0, spacing: 5, rate: 0.1 } as Garland;
  const c = garlandScene(garland);
  const lit = c.at(0);
  const xs = [...lit.keys()].map((p) => p % W).sort((a, b) => a - b);
  assert.deepEqual(xs, Array.from({ length: 17 }, (_, k) => 10 + 5 * k), "bulbs are not every 5 px from the first point to the last");
  assert.ok([...lit.keys()].every((p) => Math.floor(p / W) === 110));
  const on = new Map(xs.map((x, k) => [x, garland.colours![k % garland.colours!.length]]));
  let dims = 0, most = 0;
  for (let k = 0; k < 600; k++) {
    const now = c.at(k * 100);
    assert.equal(now.size, xs.length, `bulbs went missing at step ${k}`);
    let dimmed = 0;
    for (const [pixel, hex] of now) {
      const own = on.get(pixel % W)!;
      if (hex === palette.colours[own]) continue;
      assert.equal(hex, palette.colours[darkOf(own)], `bulb at x ${pixel % W} turned ${hex}, not one step down its Ramp`);
      dimmed++;
    }
    dims += dimmed;
    most = Math.max(most, dimmed);
  }
  assert.ok(dims > 0, "no bulb ever dimmed");
  assert.ok(most <= xs.length / 2, `${most} of ${xs.length} bulbs dimmed at once`);
  const restless = garlandScene({ ...garland, rate: 100 } as Garland);
  for (const t of [0, 900, 4700]) {
    const lit = [...restless.at(t)].filter(([pixel, hex]) => hex === palette.colours[on.get(pixel % W)!]);
    assert.equal(lit.length, 1, `${lit.length} bulbs stayed lit when every bulb rolled a dim at ${t} ms`);
  }
});

test("garland sags its wire below the chord between points, by sag px at the middle, inside its region", () => {
  const garland = { ...openSky, strands: [[{ x: 20, y: 122 }, { x: 60, y: 122 }]], sag: 4, wire: 2 } as Garland;
  const drawn = garlandScene(garland).at(0);
  const rows = [...drawn.keys()].map((p) => Math.floor(p / W));
  assert.equal(Math.min(...rows), 122);
  assert.equal(Math.max(...rows), 126);
  const lowest = [...drawn.keys()].filter((p) => Math.floor(p / W) === 126).map((p) => p % W);
  assert.ok(lowest.every((x) => Math.abs(x - 40) <= 8), `the lowest wire pixels are at ${lowest}, not mid-span`);
  const columns = new Set([...drawn.keys()].map((p) => p % W));
  for (let x = 20; x <= 60; x++) assert.ok(columns.has(x), `the wire has a gap at x ${x}`);
  const clipped = garlandScene({ ...garland, region: { x: 0, y: 100, w: 40, h: 60 } }).at(0);
  assert.ok(clipped.size > 0 && [...clipped.keys()].every((p) => p % W < 40), "the garland drew outside its region");
});

test("garland baubles are static round dots, a 3 px one rounded by its Ramp's dark step at the corners with the highlight at its centre", () => {
  const garland = { ...openSky, strands: [], baubles: [{ x: 30, y: 130, colour: 10 }, { x: 50, y: 130, colour: 3 }], baubleSize: 3, highlight: 15 } as Garland;
  const c = garlandScene(garland);
  const first = c.at(0);
  const [colour, dark, highlight] = [10, palette.ramps[10].dark, 15].map((i) => palette.colours[i]);
  const expected = new Map<number, string>();
  for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) expected.set((130 + dy) * W + 30 + dx, dx === 1 && dy === 1 ? highlight : dx !== 1 && dy !== 1 ? dark : colour);
  assert.deepEqual(new Map([...first].filter(([p]) => p % W < 40)), expected);
  for (const t of [0, 1300, 5100, 20000]) assert.deepEqual([...c.at(t)], [...first], `baubles changed at ${t} ms`);
  const small = garlandScene({ ...garland, baubleSize: 2, highlight: undefined }).at(0);
  assert.equal(small.size, 8);
  assert.ok([...small.values()].every((hex) => hex === palette.colours[10] || hex === palette.colours[3]));
});

test("a Primitive anchored to a missing Placement fails with its index and anchor", () => {
  const plan = { ...catalogue, primitives: [{ ...only("steam")[0], anchor: "teapot" } as Primitive] };
  assert.throws(() => createPrimitives({ plan, elements, palette }), /Primitive 0 \(steam\): no Placement teapot/);
});

test("the Primitives module bundles for a neutral platform and draws where no Node, DOM or Canvas API exists", async () => {
  const { build } = await import("esbuild");
  const { runInNewContext } = await import("node:vm");
  const { fileURLToPath } = await import("node:url");
  const entry = fileURLToPath(new URL("../viewer/primitives.ts", import.meta.url));
  const result = await build({ entryPoints: [entry], bundle: true, platform: "neutral", format: "iife", globalName: "primitives", write: false, logLevel: "silent" });
  const sandbox: Record<string, any> = {};
  runInNewContext(`${result.outputFiles[0].text}; globalThis.primitives = primitives;`, sandbox);
  for (const name of ["document", "window", "OffscreenCanvas", "ImageData", "Buffer", "process", "require"]) {
    assert.equal(name in sandbox, false, `${name} leaked into the sandbox`);
  }
  const draws = sandbox.primitives.createPrimitives({ plan: catalogue, elements, palette });
  const out = new Uint8ClampedArray(W * SCENE_HEIGHT * 4);
  for (const d of draws) d.draw(out, 500);
  assert.equal(draws.length, 13);
});

test("a Variant draws the base Primitives plus its own, and the base alone under a Variant that adds none", () => {
  const [rain] = only("rain");
  const [twinkle] = only("twinkle");
  const [first] = catalogue.variants;
  const plan: ScenePlan = { ...catalogue, primitives: [twinkle], variants: [first, { ...first, id: "storm", primitives: [rain] }] };
  const render = (variant: ScenePlan["variants"][number]) =>
    createCompositor({ plan, elements, palette, variant, primitives: createPrimitives({ plan, elements, palette, variant }) }).render(500);
  const plain = Buffer.from(render(plan.variants[0]));
  const storm = Buffer.from(render(plan.variants[1]));
  assert.ok(plain.equals(Buffer.from(scene([twinkle]).render(500))), "the default Variant does not draw exactly the base Primitives");
  assert.ok(storm.equals(Buffer.from(scene([twinkle, rain]).render(500))), "the storm Variant does not draw base plus its rain");
  assert.ok(!storm.equals(plain));
});
