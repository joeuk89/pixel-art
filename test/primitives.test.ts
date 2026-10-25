import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allPlacements, placementsOf, SCENE_HEIGHT, SCENE_WIDTH, scenePlanSchema, type Primitive, type ScenePlan } from "../schema/index.ts";
import { createCompositor, type Compositor } from "../viewer/compositor.ts";
import { createPrimitives, PROP_FPS, WEATHER_FPS } from "../viewer/primitives.ts";
import { loadElementPixels } from "../pipeline/lib/element-pixels.ts";
import { fixturePalette, fixtures } from "./helpers.ts";

const W = SCENE_WIDTH;
const palette = JSON.parse(readFileSync(join(fixtures, `library/palettes/${fixturePalette}.json`), "utf8"));
const paletteRgb = new Set<number>(palette.colours.map((hex: string) => parseInt(hex.slice(1), 16)));
const catalogue: ScenePlan = scenePlanSchema.parse(JSON.parse(readFileSync(join(fixtures, "primitives/scene.json"), "utf8")));
const elements = await loadElementPixels(fixtures, catalogue);
const TYPES = ["rain", "snow", "steam", "twinkle", "blink", "dust", "sway", "birds", "pendulum"] as const;
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

for (const [type, fps, idles] of [["sway", PROP_FPS, false], ["birds", WEATHER_FPS, true]] as const) {
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
const [twinkleOf, blinkOf, pendulumOf] = [only("twinkle")[0], only("blink")[0], only("pendulum")[0]];
const exactCases: [string, Primitive, boolean][] = [
  ["pendulum", pendulumOf, true],
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
  assert.equal(draws.length, 9);
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
