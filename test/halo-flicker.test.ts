import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompositor, type ElementPixels } from "../viewer/compositor.ts";

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

function plan(lights: object[], seed = 1): any {
  return {
    schemaVersion: 2, id: "test-scene-a1b2", title: "t", prompt: "t", description: "t", createdAt: "2026-10-24T20:00:00Z", seed,
    status: "draft", palette: "test-v2", scale: 48, dither: false, styleAnchor: null,
    layers: [{ name: "floor", kind: "fill", plane: "mid", colour: 2 }], primitives: [],
    variants: [{ id: "default", title: "Default", ambient: { level: 0 }, lights, emissiveOff: [] }],
    soundtrack: { music: { brief: "b", service: "s", gain: 0.6 }, ambient: [], oneshots: [] },
    cost: { pixellabGenerations: 0, meteredUsd: {}, attemptsAbandoned: 0, approvedOverage: null },
  };
}

function at(out: Uint8ClampedArray, x: number, y: number): number[] {
  const i = (y * W + x) * 4;
  return [...out.subarray(i, i + 4)];
}

const lamp = { type: "point", id: "lamp", at: { x: 200, y: 100 }, radius: 40, strength: 2, tint: "warm" };
const flicker = { depth: 0.5, rate: 0.8 };
const compositor = (lights: object[], seed = 1, elements: Map<string, ElementPixels> = new Map()) =>
  createCompositor({ plan: plan(lights, seed), elements, palette });
const TICK = 100;

function firstDip(lights: object[]): number {
  const c = compositor(lights);
  for (let t = TICK; t < 600_000; t += TICK) if (at(c.render(t), 200, 100).join() === colour(3).join()) return t;
  assert.fail("the lamp never dipped in ten minutes");
}

test("a flicker dip lowers the lit pixels by one step at a 10 fps tick and not between ticks", () => {
  const flickering = [{ ...lamp, flicker }];
  const dip = firstDip(flickering);
  const c = compositor(flickering);
  const row = (t: number) => [200, 220, 230, 231, 250].map((x) => at(c.render(t), x, 100));
  assert.deepEqual(row(dip - 1), [4, 3, 3, 2, 2].map(colour), "just before the dip the lamp lights as steady");
  assert.equal(c.tick(dip), true, "the dip is a change");
  assert.deepEqual(row(dip), [3, 2, 2, 2, 2].map(colour), "at the dip every lit pixel is one step darker, nothing below unlit");
  assert.equal(c.tick(dip + TICK - 1), false, "nothing changes before the next tick");
  assert.deepEqual(row(dip + TICK - 1), row(dip));
});

const halo = { colour: 7, radius: 30, strength: 0.5 };
const onPalette = new Set(hex.map((h) => rgba(h).join()));

test("a Halo adds its Palette colour over the lit frame with linear falloff, off the Palette only inside its radius", () => {
  const plain = compositor([lamp]).render(0);
  const glowing = compositor([{ ...lamp, halo }]).render(0);
  assert.deepEqual(at(glowing, 200, 100), [64 + 56, 64, 64, 255], "lit colour 4 plus half of #700000 at the centre");
  assert.deepEqual(at(glowing, 215, 100), [48 + 28, 48, 48, 255], "lit colour 3 plus a quarter of #700000 halfway out");
  let inside = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - 200, y - 100);
    const pixel = at(glowing, x, y);
    if (d >= halo.radius) {
      assert.deepEqual(pixel, at(plain, x, y), `pixel ${x},${y} outside the Halo changed`);
      assert.ok(onPalette.has(pixel.join()), `pixel ${x},${y} outside the Halo is off the Palette`);
    } else if (!onPalette.has(pixel.join())) inside++;
  }
  assert.ok(inside > 2000, `only ${inside} Halo pixels left the Palette`);
});

test("a flickering Halo brightens and dims with its Light at each tick", () => {
  const c = compositor([{ ...lamp, flicker, halo }]);
  const reds = Array.from({ length: 20 }, (_, k) => at(c.render(k * TICK), 200, 100)[0]);
  assert.ok(new Set(reds).size > 3, `the Halo centre barely changed: ${reds}`);
  for (const red of reds) assert.ok(red <= 64 + 56 && red >= 64 + 28, `Halo centre red ${red} outside its swing`);
  c.render(TICK);
  assert.equal(c.tick(TICK + 50), false);
});

test("a Scene without flicker reports no change after its first frame and keeps one light field", () => {
  const c = compositor([lamp, { ...lamp, id: "spill", at: { x: 60, y: 60 }, tint: "cool", halo }]);
  const first = Buffer.from(c.render(0));
  const field = c.lightField(0);
  for (const t of [1, 100, 5_000, 3_600_000]) {
    assert.equal(c.tick(t), false, `change reported at ${t} ms`);
    assert.equal(c.lightField(t), field, `light field rebuilt at ${t} ms`);
    assert.ok(Buffer.from(c.render(t)).equals(first), `frame changed at ${t} ms`);
  }
  assert.equal(c.nextTick(0), Infinity);
});

test("a flickering Light reuses its light field until a dip, then reuses the dipped one", () => {
  const flickering = [{ ...lamp, flicker }];
  const dip = firstDip(flickering);
  const c = compositor(flickering);
  const steady = c.lightField(0);
  assert.equal(c.lightField(dip - TICK), steady);
  const dipped = c.lightField(dip);
  assert.notEqual(dipped, steady);
  assert.equal(c.lightField(dip + 1), dipped);
  assert.equal(c.nextTick(dip + 1), dip + TICK);
});

test("the same seed, time and Variant give byte-identical frames with flicker and a Halo, in any render order", () => {
  const lights = [{ ...lamp, flicker, halo }];
  const times = Array.from({ length: 80 }, (_, k) => k * 137);
  const a = compositor(lights, 7);
  const b = compositor(lights, 7);
  const forward = times.map((t) => Buffer.from(a.render(t)));
  const backward = [...times].reverse().map((t) => Buffer.from(b.render(t))).reverse();
  forward.forEach((frame, k) => assert.ok(frame.equals(backward[k]), `frames differ at ${times[k]} ms`));
  const other = compositor(lights, 8);
  assert.ok(times.some((t, k) => !Buffer.from(other.render(t)).equals(forward[k])), "another seed flickers the same way");
});
