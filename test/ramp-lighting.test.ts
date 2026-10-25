import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompositor, type ElementPixels, type Pixels } from "../viewer/compositor.ts";

const W = 384;
const H = 240;
const hex = ["#000000", "#101010", "#202020", "#303030", "#404040", "#000050", "#000060", "#700000"];
const palette = {
  name: "test-v2",
  mood: "test",
  colours: hex,
  ramps: [
    { dark: 0, warm: 1, cool: 1 },
    { dark: 0, warm: 2, cool: 2 },
    { dark: 1, warm: 3, cool: 5 },
    { dark: 2, warm: 4, cool: 6 },
    { dark: 3, warm: 4, cool: 4 },
    { dark: 2, warm: 6, cool: 6 },
    { dark: 5, warm: 6, cool: 6 },
    { dark: 7, warm: 7, cool: 7 },
  ],
};
const rgba = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255, 255];
};
const colour = (i: number) => rgba(palette.colours[i]);

type Variant = Record<string, unknown>;
const variantOf = (v: Variant = {}) => ({ id: "default", title: "Default", ambient: { level: 0 }, lights: [], emissiveOff: [], ...v });

function plan(layers: unknown[], variants: Variant[] = [{}], extra: object = {}): any {
  return {
    schemaVersion: 2, id: "test-scene-a1b2", title: "t", prompt: "t", description: "t", createdAt: "2026-10-24T20:00:00Z", seed: 1,
    status: "draft", palette: "test-v2", scale: 48, dither: false, styleAnchor: null, layers, primitives: [],
    variants: variants.map(variantOf),
    soundtrack: { music: { brief: "b", service: "s", gain: 0.6 }, ambient: [], oneshots: [] },
    cost: { pixellabGenerations: 0, meteredUsd: {}, attemptsAbandoned: 0, approvedOverage: null },
    ...extra,
  };
}

const fill = (name: string, c: number, plane = "mid") => ({ name, kind: "fill", plane, colour: c });
const placed = (name: string, placements: object[], plane = "mid") => ({ name, kind: "placements", plane, placements });

function image(width: number, height: number, paint: (x: number, y: number) => number | null): Pixels {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = paint(x, y);
    if (c !== null) data.set(colour(c), (y * width + x) * 4);
  }
  return { width, height, data };
}

function at(out: Uint8ClampedArray, x: number, y: number): number[] {
  const i = (y * W + x) * 4;
  return [...out.subarray(i, i + 4)];
}

const swatch = image(8, 1, (x) => x);

function render(p: any, elements: Map<string, ElementPixels> = new Map(), options: object = {}): Uint8ClampedArray {
  return createCompositor({ plan: p, elements, palette, ...options }).render(0);
}

test("ambient -1 on a mid Layer picks each colour's first dark step", () => {
  const out = render(
    plan([placed("room", [{ id: "swatch", element: "swatch-grey-test-01", x: 10, y: 10 }])], [{ ambient: { level: -1 } }]),
    new Map([["swatch-grey-test-01", { still: swatch }]]),
  );
  for (let c = 0; c < 8; c++) assert.deepEqual(at(out, 10 + c, 10), colour(palette.ramps[c].dark), `colour ${c}`);
});

const dot = (c: number) => image(1, 1, () => c);
const dots = new Map([[ "dot-grey-test-01", { still: dot(4) } ]]);
const dotAt = (id: string, x: number) => ({ id, element: "dot-grey-test-01", x, y: 10 });

test("a Plane's default offset and a Variant's Layer override add to the ambient level", () => {
  const layers = [placed("back", [dotAt("far", 10)], "far"), placed("room", [dotAt("mid", 20)]), placed("frame", [dotAt("near", 30)], "near")];
  const plain = render(plan(layers, [{ ambient: { level: -1.5 } }]), dots);
  assert.deepEqual([at(plain, 10, 10), at(plain, 20, 10), at(plain, 30, 10)], [colour(2), colour(3), colour(2)], "far -2, mid -1, near -2 after rounding");
  const overridden = render(plan(layers, [{ ambient: { level: -1.5, layers: { back: 1, room: -1.5 } } }]), dots);
  assert.deepEqual([at(overridden, 10, 10), at(overridden, 20, 10), at(overridden, 30, 10)], [colour(4), colour(1), colour(2)], "far 0, mid -3, near unchanged");
});

const lamp = image(1, 1, () => null);
const lit = (lights: object[], ambient = 0, layers: unknown[] = [fill("floor", 2)]) =>
  render(plan(layers, [{ ambient: { level: ambient }, lights }]), new Map([["lamp-test-light-01", { still: lamp }]]));

test("a point Light falls off linearly from its centre and lights toward warm or cool by its tint", () => {
  const warm = lit([{ type: "point", id: "lamp", at: { x: 200, y: 100 }, radius: 40, strength: 2, tint: "warm" }]);
  assert.deepEqual([at(warm, 200, 100), at(warm, 220, 100), at(warm, 230, 100), at(warm, 231, 100), at(warm, 200, 70), at(warm, 250, 100)], [4, 3, 3, 2, 3, 2].map(colour));
  const cool = lit([{ type: "point", id: "lamp", at: { x: 200, y: 100 }, radius: 40, strength: 2, tint: "cool" }]);
  assert.deepEqual([at(cool, 200, 100), at(cool, 220, 100), at(cool, 231, 100)], [colour(6), colour(5), colour(2)]);
});

test("where two Lights overlap, the stronger one at the pixel picks the tint", () => {
  const out = lit([
    { type: "point", id: "lamp", at: { x: 100, y: 100 }, radius: 60, strength: 2, tint: "warm" },
    { type: "point", id: "screen", at: { x: 140, y: 100 }, radius: 60, strength: 2, tint: "cool" },
  ]);
  assert.deepEqual(at(out, 110, 100), colour(4), "warm 1.67 + cool 0.5 rounds to 2, warm");
  assert.deepEqual(at(out, 130, 100), colour(6), "warm 0.5 + cool 1.67 rounds to 2, cool");
});

test("a point Light anchored to a Placement sits at the Placement plus its offset", () => {
  const layers = [fill("floor", 2), placed("room", [{ id: "lamp", element: "lamp-test-light-01", x: 50, y: 60 }])];
  const out = lit([{ type: "point", id: "lamp", anchor: "lamp", offset: { x: 10, y: 5 }, radius: 4, strength: 2, tint: "warm" }], 0, layers);
  assert.deepEqual([at(out, 60, 65), at(out, 50, 60)], [colour(4), colour(2)]);
});

test("a point Light anchored to a foot Placement sits at the Placement's drawn position plus its offset", () => {
  const stage = { back: { x: 0, y: 40, w: 384, h: 140 }, vanishingPoint: { x: 190, y: 100 }, f: 150 };
  const layers = [fill("floor", 2), placed("room", [{ id: "lamp", element: "lamp-test-light-01", foot: { x: 100, y: 200 } }])];
  const p = plan(layers, [{ ambient: { level: 0 }, lights: [{ type: "point", id: "lamp", anchor: "lamp", offset: { x: 2, y: 1 }, radius: 4, strength: 2, tint: "warm" }] }], { stage });
  const out = render(p, new Map([["lamp-test-light-01", { still: image(4, 6, () => null) }]]));
  assert.deepEqual([at(out, 100, 195), at(out, 100, 201)], [colour(4), colour(2)], "drawn at 98,194; the Light at 100,195");
});

test("a beam lights the inside of its quad at full strength and steps down across its soft edge", () => {
  const corners = [{ x: 100, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 150 }, { x: 100, y: 150 }];
  const out = lit([{ type: "beam", id: "sun", corners, strength: 3, tint: "warm", softness: 6 }], 0, [fill("floor", 1)]);
  const row = Array.from({ length: 9 }, (_, k) => at(out, 99 + k, 100));
  assert.deepEqual(row, [1, 1, 2, 2, 3, 3, 4, 4, 4].map(colour), "outside, then 0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3, 3 steps");
  assert.deepEqual(at(out, 150, 100), colour(4));
  const hard = lit([{ type: "beam", id: "sun", corners, strength: 3, tint: "cool", softness: 0 }], 0, [fill("floor", 1)]);
  assert.deepEqual([at(hard, 99, 100), at(hard, 100, 100)], [colour(1), colour(6)], "softness 0 is a hard edge: three cool steps from 1 are 2, 5, 6");
});

const sign = image(3, 1, (x) => (x < 2 ? 4 : 2));
const signScene = (variant: Variant = {}) =>
  plan([placed("room", [{ id: "sign", element: "sign-neon-test-01", x: 10, y: 10 }])], [{ ambient: { level: -2 }, ...variant }]);

test("an emissive colour keeps its colour while the rest of the Element is lit", () => {
  const out = render(signScene(), new Map([["sign-neon-test-01", { still: sign, emissive: [4] }]]));
  assert.deepEqual([at(out, 10, 10), at(out, 11, 10), at(out, 12, 10)], [colour(4), colour(4), colour(0)]);
});

test("with a mask an emissive colour is kept only where the mask is white", () => {
  const mask: Pixels = { width: 3, height: 1, data: new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]) };
  const out = render(signScene(), new Map([["sign-neon-test-01", { still: sign, emissive: [4], mask }]]));
  assert.deepEqual([at(out, 10, 10), at(out, 11, 10), at(out, 12, 10)], [colour(4), colour(2), colour(0)]);
});

test("a Variant's emissiveOff lights the named Placement's emissive colours like any other", () => {
  const out = render(signScene({ emissiveOff: ["sign"] }), new Map([["sign-neon-test-01", { still: sign, emissive: [4] }]]));
  assert.deepEqual([at(out, 10, 10), at(out, 11, 10)], [colour(2), colour(2)]);
});

test("an emissive Primitive keeps its colours and a lit one is lit with the Layer it draws after", () => {
  const primitive = (emissive: boolean) => ({ after: 0, fps: 24, emissive, draw: (out: Uint8ClampedArray) => out.set(colour(4), (5 * W + 5) * 4) });
  const scene = plan([fill("floor", 1)], [{ ambient: { level: -2 } }]);
  const make = (emissive: boolean) => createCompositor({ plan: scene, elements: new Map(), palette, primitives: [primitive(emissive)] }).render(0);
  assert.deepEqual(at(make(true), 5, 5), colour(4));
  assert.deepEqual(at(make(false), 5, 5), colour(2));
});

test("dither changes nothing at a whole level and splits a half level evenly between its two steps", () => {
  const whole = (dither: boolean) => render(plan([fill("floor", 4)], [{ ambient: { level: -1 } }], { dither }));
  assert.deepEqual(Buffer.from(whole(true)), Buffer.from(whole(false)));
  const half = (dither: boolean) => render(plan([fill("floor", 4)], [{ ambient: { level: -1.5 } }], { dither }));
  const plain = half(false);
  const dithered = half(true);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) assert.deepEqual(at(plain, x, y), colour(3));
  for (const [bx, by] of [[0, 0], [100, 60], [380, 236]]) {
    const block = Array.from({ length: 16 }, (_, k) => at(dithered, bx + (k % 4), by + Math.floor(k / 4)));
    assert.equal(block.filter((c) => c.join() === colour(3).join()).length, 8, `block at ${bx},${by}`);
    assert.equal(block.filter((c) => c.join() === colour(2).join()).length, 8, `block at ${bx},${by}`);
  }
});

test("a clamped ramp stops at a step naming the colour itself", () => {
  const out = render(plan([fill("floor", 7)], [{ ambient: { level: -4 } }]));
  assert.deepEqual(at(out, 10, 10), colour(7), "four dark steps from 7 stay on 7");
  const bright = render(plan([fill("floor", 4)], [{ ambient: { level: 3 } }]));
  assert.deepEqual(at(bright, 10, 10), colour(4), "three warm steps from 4 stay on 4");
});

test("a companion Palette colours the frame through its own colours and Ramps", () => {
  const companion = {
    name: "test-dusk-v2",
    mood: "dusk",
    colours: ["#000001", "#100011", "#200021", "#300031", "#400041", "#500051", "#600061", "#700071"],
    ramps: palette.ramps.map((r, i) => (i === 3 ? { ...r, dark: 6 } : r)),
  };
  const scene = plan([fill("floor", 3), placed("room", [dotAt("dot", 10)])], [{ ambient: { level: -1 }, companionPalette: "test-dusk-v2" }]);
  const out = render(scene, dots, { companion });
  assert.deepEqual(at(out, 200, 200), rgba(companion.colours[6]), "colour 3 takes the companion's dark step");
  assert.deepEqual(at(out, 10, 10), rgba(companion.colours[3]), "colour 4 darkens to 3, shown in the companion's colour");
  assert.throws(() => render(scene, dots, { companion: { ...companion, colours: companion.colours.slice(1), ramps: companion.ramps.slice(1) } }), /7 colours/);
});

test("every pixel of a lit frame with Lights, a beam, emissive colours and dither is a Palette colour", () => {
  const scene = plan(
    [fill("sky", 5, "far"), placed("room", [{ id: "sign", element: "sign-neon-test-01", x: 40, y: 40 }, dotAt("dot", 300)]), placed("frame", [dotAt("near", 330)], "near")],
    [{
      ambient: { level: -2.5, layers: { sky: -0.25 } },
      lights: [
        { type: "point", id: "lamp", anchor: "sign", offset: { x: 1, y: 0 }, radius: 150, strength: 4.5, tint: "warm" },
        { type: "point", id: "spill", at: { x: 300, y: 50 }, radius: 124, strength: 1.75, tint: "cool" },
        { type: "beam", id: "sun", corners: [{ x: 150, y: 0 }, { x: 220, y: 0 }, { x: 300, y: 239 }, { x: 124, y: 239 }], strength: 2.5, tint: "warm", softness: 9 },
      ],
    }],
    { dither: true },
  );
  const out = render(scene, new Map([["sign-neon-test-01", { still: sign, emissive: [4] }], ["dot-grey-test-01", { still: dot(4) }]]));
  const on = new Set(palette.colours.map((h) => rgba(h).join()));
  const seen = new Set<string>();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = at(out, x, y).join();
    assert.ok(on.has(c), `pixel ${x},${y} is ${c}`);
    seen.add(c);
  }
  assert.ok(seen.size >= 4, `only ${seen.size} colours: the frame is barely lit`);
});

test("the compositor plays the default Variant unless it is given another", () => {
  const scene = plan([fill("floor", 4)], [{ id: "night", ambient: { level: -2 } }, { id: "day", ambient: { level: 0 } }]);
  assert.deepEqual(at(render(scene), 0, 0), colour(2));
  assert.deepEqual(at(render(scene, new Map(), { variant: scene.variants[1] }), 0, 0), colour(4));
});
