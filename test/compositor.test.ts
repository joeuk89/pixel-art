import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompositor, type ElementPixels, type Pixels } from "../viewer/compositor.ts";

const W = 384;
const H = 240;
const colours = ["#100000", "#200000", "#300000", "#400000", "#500000", "#600000", "#700000", "#800000"];
const palette = { name: "test", mood: "test", colours, ramps: colours.map((_, i) => ({ dark: i, warm: i, cool: i })) };
const rgb = (i: number) => [(i + 1) * 16, 0, 0, 255];

function plan(layers: unknown[], seed = 1337): any {
  return {
    schemaVersion: 2, id: "test-scene-a1b2", title: "t", prompt: "t", description: "t", createdAt: "2026-10-24T20:00:00Z", seed,
    status: "draft", palette: "test", scale: 48, dither: false, styleAnchor: null, layers, primitives: [],
    variants: [{ id: "default", title: "Default", ambient: { level: 0 }, lights: [], emissiveOff: [] }],
    soundtrack: { music: { brief: "b", service: "s", gain: 0.6 }, ambient: [], oneshots: [] },
    cost: { pixellabGenerations: 0, meteredUsd: {}, attemptsAbandoned: 0, approvedOverage: null },
  };
}

const fill = (name: string, colour: number) => ({ name, kind: "fill", plane: "far", colour });
const placed = (name: string, placements: object[]) => ({ name, kind: "placements", plane: "mid", placements });

function image(width: number, height: number, paint: (x: number, y: number) => number[] | null): Pixels {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const c = paint(x, y);
    if (c) data.set(c, (y * width + x) * 4);
  }
  return { width, height, data };
}

function at(out: Uint8ClampedArray, x: number, y: number): number[] {
  const i = (y * W + x) * 4;
  return [...out.subarray(i, i + 4)];
}

test("an empty Scene is a 384x240 frame letterboxed in Palette index 0", () => {
  const out = createCompositor({ plan: plan([placed("room", [])]), elements: new Map(), palette }).render(0);
  assert.equal(out.length, 384 * 240 * 4);
  for (const [x, y] of [[0, 0], [383, 239], [200, 100], [383, 0], [0, 239]]) assert.deepEqual(at(out, x, y), rgb(0));
});

test("a fill Layer paints the whole Scene and later Layers draw over it", () => {
  const dot = image(1, 1, () => rgb(5));
  const out = createCompositor({
    plan: plan([fill("sky", 3), placed("room", [{ id: "dot", element: "dot-red-small-01", x: 10, y: 10 }])]),
    elements: new Map([["dot-red-small-01", { still: dot }]]),
    palette,
  }).render(0);
  assert.deepEqual(at(out, 0, 0), rgb(3));
  assert.deepEqual(at(out, 383, 239), rgb(3));
  assert.deepEqual(at(out, 10, 10), rgb(5));
});

const arrow = image(4, 2, (x, y) => (x === 3 && y === 1 ? null : x === 0 ? rgb(1) : rgb(2)));
const arrowScene = (placement: object) =>
  createCompositor({
    plan: plan([placed("room", [{ id: "arrow", element: "arrow-red-small-01", ...placement }])]),
    elements: new Map([["arrow-red-small-01", { still: arrow }]]),
    palette,
  }).render(0);

test("a Placement draws at its integer position at native size, transparent pixels showing what is behind", () => {
  const out = arrowScene({ x: 50, y: 20 });
  assert.deepEqual(at(out, 50, 20), rgb(1));
  assert.deepEqual(at(out, 51, 20), rgb(2));
  assert.deepEqual(at(out, 53, 20), rgb(2));
  assert.deepEqual(at(out, 53, 21), rgb(0));
  assert.deepEqual(at(out, 54, 20), rgb(0));
  assert.deepEqual(at(out, 50, 22), rgb(0));
  assert.deepEqual(at(out, 49, 20), rgb(0));
});

test("a Placement partly off the Scene is clipped", () => {
  const out = arrowScene({ x: 382, y: -1 });
  assert.deepEqual(at(out, 382, 0), rgb(1));
  assert.deepEqual(at(out, 383, 0), rgb(2));
});

test("a Placement near the far corner of the 384x240 canvas draws at its position", () => {
  const out = arrowScene({ x: 370, y: 230 });
  assert.deepEqual([at(out, 370, 230), at(out, 371, 230), at(out, 373, 231), at(out, 370, 231)], [rgb(1), rgb(2), rgb(0), rgb(1)]);
});

test("flipX mirrors the Element in place", () => {
  const out = arrowScene({ x: 50, y: 20, flipX: true });
  assert.deepEqual(at(out, 53, 20), rgb(1));
  assert.deepEqual(at(out, 50, 20), rgb(2));
  assert.deepEqual(at(out, 50, 21), rgb(0));
  assert.deepEqual(at(out, 51, 21), rgb(2));
});

test("tileX repeats a Seamless texture across the whole 384 px width, left of x too", () => {
  const out = arrowScene({ x: 2, y: 20, tileX: true });
  for (let x = 0; x < W; x++) {
    const col = (((x - 2) % 4) + 4) % 4;
    assert.deepEqual(at(out, x, 20), col === 0 ? rgb(1) : rgb(2), `x ${x}`);
    assert.deepEqual(at(out, x, 21), col === 3 ? rgb(0) : col === 0 ? rgb(1) : rgb(2), `x ${x}`);
  }
  assert.deepEqual(at(out, 2, 22), rgb(0));
});

test("tileX with flipX tiles the mirrored Element", () => {
  const out = arrowScene({ x: 0, y: 0, tileX: true, flipX: true });
  assert.deepEqual([at(out, 0, 0), at(out, 3, 0), at(out, 4, 1), at(out, 7, 0)], [rgb(2), rgb(1), rgb(0), rgb(1)]);
});

const STILL_COLOUR = 7;
function stripElement(frames: number, fps = 6, order: any = "cycle"): ElementPixels {
  return {
    still: image(2, 1, () => rgb(STILL_COLOUR)),
    strip: { image: image(2 * frames, 1, (x) => rgb(1 + Math.floor(x / 2))), frames, fps, order },
  };
}

function frameAt(out: Uint8ClampedArray, x: number, y: number): number {
  const [r] = at(out, x, y);
  return r / 16 - 2;
}

function framesOver(pixels: ElementPixels, placement: object, steps: number, fps: number, seed = 1337): number[] {
  const c = createCompositor({
    plan: plan([placed("room", [{ id: "cat", element: "cat-tabby-asleep-01", x: 10, y: 10, ...placement }])], seed),
    elements: new Map([["cat-tabby-asleep-01", pixels]]),
    palette,
  });
  return Array.from({ length: steps }, (_, k) => frameAt(c.render(k * (1000 / fps) + 1), 10, 10));
}

function assertRotationOf(observed: number[], cycle: number[]): void {
  const matches = cycle.some((_, r) => observed.every((f, k) => f === cycle[(r + k) % cycle.length]));
  assert.ok(matches, `${JSON.stringify(observed)} is not a rotation of ${JSON.stringify(cycle)} repeated`);
}

test("a cycle strip plays frames 0 to n-1 and wraps, one step per 1/fps seconds", () => {
  assertRotationOf(framesOver(stripElement(4, 5), {}, 12, 5), [0, 1, 2, 3]);
});

test("a pingpong strip plays forward then back without repeating the end frames", () => {
  assertRotationOf(framesOver(stripElement(4), { animation: { order: "pingpong", fps: 4 } }, 18, 4), [0, 1, 2, 3, 2, 1]);
});

test("an explicit order list plays its frame indices with repeats as holds", () => {
  assertRotationOf(framesOver(stripElement(3), { animation: { order: [0, 0, 0, 2, 1] } }, 15, 6), [0, 0, 0, 2, 1]);
});

test("the Element record's fps and order apply when the Placement does not override them", () => {
  const pixels = stripElement(3, 2, "pingpong");
  assertRotationOf(framesOver(pixels, {}, 8, 2), [0, 1, 2, 1]);
  const halfSteps = framesOver(pixels, {}, 8, 4);
  for (let k = 0; k < 8; k += 2) assert.equal(halfSteps[k], halfSteps[k + 1], "a 2 fps strip holds each frame for two 4 fps samples");
});

test("a Placement with animation disabled draws the still at every time", () => {
  assert.deepEqual(framesOver(stripElement(4), { animation: { enabled: false } }, 6, 6), Array(6).fill(STILL_COLOUR - 1));
});

test("a strip drawn with flipX mirrors the selected frame", () => {
  const pixels: ElementPixels = {
    still: image(2, 1, () => rgb(STILL_COLOUR)),
    strip: { image: image(4, 1, (x) => rgb(x)), frames: 2, fps: 6, order: "cycle" },
  };
  const c = createCompositor({
    plan: plan([placed("room", [{ id: "cat", element: "cat-tabby-asleep-01", x: 10, y: 10, flipX: true }])]),
    elements: new Map([["cat-tabby-asleep-01", pixels]]),
    palette,
  });
  for (let k = 0; k < 2; k++) {
    const out = c.render(k * (1000 / 6) + 1);
    const left = at(out, 10, 10)[0] / 16 - 1;
    const right = at(out, 11, 10)[0] / 16 - 1;
    assert.equal(left, right + 1, "the right pixel of the frame lands on the left");
    assert.equal(right % 2, 0);
  }
});

function twins(seed: number, count = 8): number[] {
  const placements = Array.from({ length: count }, (_, i) => ({ id: `cat-${i + 1}`, element: "cat-tabby-asleep-01", x: i * 4, y: 0 }));
  const out = createCompositor({
    plan: plan([placed("room", placements)], seed),
    elements: new Map([["cat-tabby-asleep-01", stripElement(4)]]),
    palette,
  }).render(0);
  return placements.map((p) => frameAt(out, p.x, 0));
}

test("Placements of the same Element start on seeded offsets that differ between twins", () => {
  assert.ok(new Set(twins(1337)).size > 1, `all twins start on the same frame: ${twins(1337)}`);
  assert.notDeepEqual(twins(1337), twins(4242), "a different seed gives different start frames");
});

test("the same seed and time give byte-identical output across two compositors", () => {
  const make = () => {
    const placements = Array.from({ length: 8 }, (_, i) => ({ id: `cat-${i + 1}`, element: "cat-tabby-asleep-01", x: i * 4, y: 0 }));
    return createCompositor({
      plan: plan([fill("sky", 2), placed("room", placements)], 99),
      elements: new Map([["cat-tabby-asleep-01", stripElement(4)]]),
      palette,
    });
  };
  const a = make();
  const b = make();
  for (const t of [0, 1234, 98765]) assert.deepEqual(Buffer.from(a.render(t)), Buffer.from(b.render(t)), `t ${t}`);
});

test("an animated Placement keeps its place in draw order between still Placements", () => {
  const cover = image(1, 1, () => rgb(5));
  const c = createCompositor({
    plan: plan([
      placed("back", [{ id: "under", element: "dot-red-small-01", x: 11, y: 10 }]),
      placed("mid", [{ id: "cat", element: "cat-tabby-asleep-01", x: 10, y: 10 }, { id: "over", element: "dot-red-small-01", x: 10, y: 10 }]),
    ]),
    elements: new Map([["cat-tabby-asleep-01", stripElement(4)], ["dot-red-small-01", { still: cover }]]),
    palette,
  });
  for (let k = 0; k < 4; k++) {
    const out = c.render(k * (1000 / 6) + 1);
    assert.deepEqual(at(out, 10, 10), rgb(5), "the still drawn after the strip covers it");
    assert.notDeepEqual(at(out, 11, 10), rgb(5), "the strip covers the still drawn before it");
  }
});

test("a fill Layer after an animated Placement hides it", () => {
  const c = createCompositor({
    plan: plan([placed("room", [{ id: "cat", element: "cat-tabby-asleep-01", x: 10, y: 10 }]), fill("wall", 4)]),
    elements: new Map([["cat-tabby-asleep-01", stripElement(4)]]),
    palette,
  });
  assert.deepEqual(at(c.render(0), 10, 10), rgb(4));
});

test("tick reports a change only when a strip's frame step has moved since the last render", () => {
  const c = createCompositor({
    plan: plan([placed("room", [{ id: "cat", element: "cat-tabby-asleep-01", x: 0, y: 0, animation: { fps: 4 } }])]),
    elements: new Map([["cat-tabby-asleep-01", stripElement(4)]]),
    palette,
  });
  assert.equal(c.tick(0), true, "nothing rendered yet");
  c.render(0);
  assert.equal(c.tick(100), false);
  assert.equal(c.tick(249), false);
  assert.equal(c.tick(250), true);
  assert.equal(c.nextTick(100), 250);
  c.render(260);
  assert.equal(c.tick(400), false);
  assert.equal(c.nextTick(400), 500);
});

test("a Scene with nothing animated never ticks after its first render", () => {
  const c = createCompositor({ plan: plan([fill("sky", 1)]), elements: new Map(), palette });
  c.render(0);
  assert.equal(c.tick(60_000), false);
  assert.equal(c.nextTick(0), Infinity);
});

test("a Primitive draws after the Layer it names, under later Layers, and joins the tick", () => {
  const cover = image(1, 1, () => rgb(5));
  const primitive = { after: 0, fps: 24, draw: (out: Uint8ClampedArray) => { out.set(rgb(6), (0 * W + 20) * 4); out.set(rgb(6), (0 * W + 21) * 4); } };
  const c = createCompositor({
    plan: plan([fill("sky", 1), placed("room", [{ id: "over", element: "dot-red-small-01", x: 21, y: 0 }])]),
    elements: new Map([["dot-red-small-01", { still: cover }]]),
    palette,
    primitives: [primitive],
  });
  const out = c.render(0);
  assert.deepEqual(at(out, 20, 0), rgb(6));
  assert.deepEqual(at(out, 21, 0), rgb(5));
  assert.equal(c.nextTick(0), 1000 / 24);
});

test("the compositor bundles for a neutral platform and renders where no Node, DOM or Canvas API exists", async () => {
  const { build } = await import("esbuild");
  const { runInNewContext } = await import("node:vm");
  const { fileURLToPath } = await import("node:url");
  const entry = fileURLToPath(new URL("../viewer/compositor.ts", import.meta.url));
  const result = await build({ entryPoints: [entry], bundle: true, platform: "neutral", format: "iife", globalName: "compositor", write: false, logLevel: "silent" });
  const sandbox: Record<string, any> = {};
  runInNewContext(`${result.outputFiles[0].text}; globalThis.compositor = compositor;`, sandbox);
  for (const name of ["document", "window", "OffscreenCanvas", "ImageData", "Buffer", "process", "require"]) {
    assert.equal(name in sandbox, false, `${name} leaked into the sandbox`);
  }
  const out = sandbox.compositor.createCompositor({ plan: plan([fill("sky", 2)]), elements: new Map(), palette }).render(0);
  assert.deepEqual([...out.subarray(0, 4)], rgb(2));
});

const block = (colour: number) => image(4, 6, () => rgb(colour));
const footScene = (placements: object[]) =>
  createCompositor({
    plan: plan([placed("room", placements)]),
    elements: new Map([["block-red-near-01", { still: block(3) }], ["block-red-far-01", { still: block(4) }]]),
    palette,
  }).render(0);

test("a foot Placement draws with its bottom centre at the foot", () => {
  const out = footScene([{ id: "near", element: "block-red-near-01", foot: { x: 100, y: 200 } }]);
  assert.deepEqual(at(out, 98, 194), rgb(3));
  assert.deepEqual(at(out, 101, 199), rgb(3));
  assert.deepEqual(at(out, 97, 199), rgb(0));
  assert.deepEqual(at(out, 102, 199), rgb(0));
  assert.deepEqual(at(out, 98, 193), rgb(0));
  assert.deepEqual(at(out, 98, 200), rgb(0));
});

for (const order of ["near first", "far first"]) {
  test(`a nearer foot Placement covers a further one whatever the Placement order (${order})`, () => {
    const near = { id: "near", element: "block-red-near-01", foot: { x: 100, y: 202 } };
    const far = { id: "far", element: "block-red-far-01", foot: { x: 101, y: 199 } };
    const out = footScene(order === "near first" ? [near, far] : [far, near]);
    assert.deepEqual(at(out, 100, 197), rgb(3));
    assert.deepEqual(at(out, 101, 196), rgb(3));
    assert.deepEqual(at(out, 102, 194), rgb(4));
  });
}

test("x, y Placements keep their order around foot Placements", () => {
  const out = footScene([
    { id: "far", element: "block-red-far-01", foot: { x: 101, y: 205 } },
    { id: "wall", element: "block-red-near-01", x: 99, y: 199 },
  ]);
  assert.deepEqual(at(out, 100, 200), rgb(3));
});

const room = (name: string) => ({ name, kind: "room", plane: "mid", surfaces: { back: { colour: 4 } }, openings: [], placements: [] });
const stage = { back: { x: 0, y: 0, w: 384, h: 240 }, vanishingPoint: { x: 190, y: 118 }, f: 150 };
const shell = image(W, H, (x, y) => (x >= 100 && x < 140 && y >= 50 && y < 80 ? null : rgb(4)));

test("room.png draws in the room Layer's place: over the Layers before it, under the Layers after it", () => {
  const dot = image(1, 1, () => rgb(6));
  const out = createCompositor({
    plan: { ...plan([fill("sky", 2), room("shell"), placed("props", [{ id: "dot", element: "dot-red-small-01", x: 20, y: 20 }])]), stage },
    elements: new Map([["dot-red-small-01", { still: dot }]]),
    room: shell,
    palette,
  }).render(0);
  assert.deepEqual(at(out, 0, 0), rgb(4));
  assert.deepEqual(at(out, 383, 239), rgb(4));
  assert.deepEqual(at(out, 20, 20), rgb(6));
});

test("a far Layer shows through an Opening in room.png", () => {
  const sky = image(W, H, (x) => rgb(x < 124 ? 1 : 3));
  const out = createCompositor({
    plan: { ...plan([placed("city", [{ id: "city", element: "city-red-wide-01", x: 0, y: 0 }]), room("shell")]), stage },
    elements: new Map([["city-red-wide-01", { still: sky }]]),
    room: shell,
    palette,
  }).render(0);
  assert.deepEqual(at(out, 100, 50), rgb(1));
  assert.deepEqual(at(out, 139, 79), rgb(3));
  assert.deepEqual(at(out, 99, 50), rgb(4));
  assert.deepEqual(at(out, 140, 79), rgb(4));
});

test("a plan with a room Layer and no room.png pixels fails to compose", () => {
  assert.throws(() => createCompositor({ plan: { ...plan([room("shell")]), stage }, elements: new Map(), palette }), /room Layer shell: room\.png has no pixels/);
});
