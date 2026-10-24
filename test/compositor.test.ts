import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompositor, type ElementSprite, type Pixels } from "../viewer/compositor.ts";

const W = 192;
const H = 120;
const palette = { name: "test", mood: "test", colours: ["#100000", "#200000", "#300000", "#400000", "#500000", "#600000", "#700000", "#800000"] };
const rgb = (i: number) => [(i + 1) * 16, 0, 0, 255];

function plan(layers: unknown[], seed = 1337): any {
  return {
    schemaVersion: 1, id: "test-scene-a1b2", title: "t", prompt: "t", createdAt: "2026-10-24T20:00:00Z", seed,
    status: "draft", palette: "test", scale: 48, styleAnchor: null, layers, primitives: [],
    soundtrack: { music: { brief: "b", service: "s", gain: 0.6 }, ambient: [], oneshots: [] },
    cost: { pixellabGenerations: 0, meteredUsd: {}, attemptsAbandoned: 0, approvedOverage: null },
  };
}

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

test("an empty Scene is letterboxed in Palette index 0", () => {
  const out = createCompositor({ plan: plan([{ name: "room", placements: [] }]), elements: new Map(), palette }).render(0);
  assert.equal(out.length, W * H * 4);
  for (const [x, y] of [[0, 0], [191, 119], [96, 60]]) assert.deepEqual(at(out, x, y), rgb(0));
});

test("a fill Layer paints the whole Scene and later Layers draw over it", () => {
  const dot = image(1, 1, () => rgb(5));
  const out = createCompositor({
    plan: plan([{ name: "sky", fill: 3 }, { name: "room", placements: [{ id: "dot", element: "dot-red-small-01", x: 10, y: 10 }] }]),
    elements: new Map([["dot-red-small-01", { still: dot }]]),
    palette,
  }).render(0);
  assert.deepEqual(at(out, 0, 0), rgb(3));
  assert.deepEqual(at(out, 191, 119), rgb(3));
  assert.deepEqual(at(out, 10, 10), rgb(5));
});

const arrow = image(4, 2, (x, y) => (x === 3 && y === 1 ? null : x === 0 ? rgb(1) : rgb(2)));
const arrowScene = (placement: object) =>
  createCompositor({
    plan: plan([{ name: "room", placements: [{ id: "arrow", element: "arrow-red-small-01", ...placement }] }]),
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
  const out = arrowScene({ x: 190, y: -1 });
  assert.deepEqual(at(out, 190, 0), rgb(1));
  assert.deepEqual(at(out, 191, 0), rgb(2));
});

test("flipX mirrors the Element in place", () => {
  const out = arrowScene({ x: 50, y: 20, flipX: true });
  assert.deepEqual(at(out, 53, 20), rgb(1));
  assert.deepEqual(at(out, 50, 20), rgb(2));
  assert.deepEqual(at(out, 50, 21), rgb(0));
  assert.deepEqual(at(out, 51, 21), rgb(2));
});

test("tileX repeats the Element across the whole Scene width, left of x too", () => {
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
