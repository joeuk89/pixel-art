import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scenePlanSchema, type Primitive, type ScenePlan } from "../schema/index.ts";
import { createCompositor, type Compositor } from "../viewer/compositor.ts";
import { createPrimitives, PROP_FPS, WEATHER_FPS } from "../viewer/primitives.ts";
import { loadElementPixels } from "../pipeline/lib/element-pixels.ts";
import { fixtures, repo } from "./helpers.ts";

const W = 192;
const palette = JSON.parse(readFileSync(join(repo, "library/palettes/cosy-night.json"), "utf8"));
const paletteRgb = new Set<number>(palette.colours.map((hex: string) => parseInt(hex.slice(1), 16)));
const catalogue: ScenePlan = scenePlanSchema.parse(JSON.parse(readFileSync(join(fixtures, "primitives/scene.json"), "utf8")));
const elements = await loadElementPixels(fixtures, catalogue);
const TYPES = ["rain", "snow", "glow", "steam", "twinkle", "blink"] as const;
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
  const layers = catalogue.layers.map((layer) => ({
    ...layer,
    placements: layer.placements?.map((p) => (p.id === "cat" ? { ...p, animation: { enabled: false } } : p)),
  }));
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

for (const type of ["steam", "twinkle"]) {
  test(`${type} makes a redraw due every 1/10 s and not in between`, () => {
    const c = stillScene(only(type));
    c.render(0);
    assert.equal(c.nextTick(0), 100);
    assert.equal(c.tick(99), false);
    assert.equal(c.tick(100), true);
  });
}

for (const [type, exact] of [["glow", false], ["blink", true]] as const) {
  test(`${type} makes a redraw due at a 1/10 s step whenever its pixels change${exact ? ", and only then" : ""}, and stays idle while they hold`, () => {
    const c = stillScene(only(type));
    let due = 0;
    let idle = 0;
    c.render(0);
    for (let k = 1; k <= 400; k++) {
      assert.equal(c.nextTick((k - 1) * 100), k * 100);
      const before = Buffer.from(c.render((k - 1) * 100));
      const tick = c.tick(k * 100);
      const changed = !before.equals(Buffer.from(c.render(k * 100)));
      if (changed || exact) assert.equal(tick, changed, `step ${k}: tick ${tick}, pixels changed ${changed}`);
      if (tick) due++;
      else idle++;
    }
    assert.ok(due > 0 && idle > 0, `due ${due}, idle ${idle}`);
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
