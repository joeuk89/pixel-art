import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixtures, makeTree, runScript, writeJson } from "./helpers.ts";

const PLAN = "scenes/rainy-desk-night-k7f2/scene.json";

function treeWithExample(edit: (plan: any) => void = () => {}): string {
  const root = makeTree();
  const plan = JSON.parse(readFileSync(join(fixtures, "spec-example-scene.json"), "utf8"));
  edit(plan);
  writeJson(root, PLAN, plan);
  return root;
}

test("derive-canvas prints the canvas and anchor fit for every unresolved generate block", () => {
  const { code, out, stderr } = runScript(treeWithExample(), "derive-canvas", PLAN);
  assert.equal(code, 0, stderr);
  assert.equal(out.ok, true);
  assert.equal(out.scale, 48);
  assert.deepEqual(out.styleAnchor, { id: "window-wood-transparent-panes-01", width: 48, height: 48 });
  assert.deepEqual(out.placements, [
    { layer: "city", placement: "skyline", element: "skyline-night-warm-windows-01", kind: "backdrop", canvas: { width: 256, height: 128 },
      tier: { service: "pro-flash", generations: 9 }, anchorFits: true },
    { layer: "room", placement: "cat", element: "cat-tabby-asleep-01", kind: "prop", scale: 48, realSize: { w: 0.5, h: 0.25 }, canvas: { width: 24, height: 16 },
      tier: { service: "pro-flash", generations: 5 }, anchorFits: false },
  ]);
  assert.equal(out.generations, 14);
});

const prop = (id: string, w: number, h: number) => ({
  id,
  element: `${id}-plain-test-01`,
  x: 0,
  y: 0,
  generate: { kind: "prop", brief: `a ${id}`, realSize: { w, h }, tags: [id] },
});

for (const [scale, w, h, width, height] of [
  [48, 1, 1, 48, 48],
  [48, 0.5, 0.25, 24, 16],
  [50, 0.56, 0.3, 28, 16],
  [24, 0.9, 1.1, 24, 28],
  [64, 0.1, 0.1, 16, 16],
  [8, 3, 0.5, 24, 16],
  [48, 2.6, 1, 128, 48],
  [64, 2, 1, 128, 64],
  [64, 2.5, 2.9, 160, 188],
  [96, 3, 2.7, 256, 256],
] as const) {
  test(`derive-canvas gives a ${w} x ${h} m prop at Scale ${scale} a ${width}x${height} canvas`, () => {
    const root = treeWithExample((plan) => {
      plan.scale = scale;
      plan.styleAnchor = null;
      plan.layers = [{ name: "room", kind: "placements", plane: "mid", placements: [prop("thing", w, h)] }];
    });
    const { code, out, stderr } = runScript(root, "derive-canvas", PLAN);
    assert.equal(code, 0, stderr);
    assert.deepEqual(out.placements[0].canvas, { width, height });
    assert.equal(out.placements[0].anchorFits, null);
  });
}

test("a Backdrop's canvas is the size its generate block names", () => {
  const root = treeWithExample((plan) => { plan.layers[2].placements[0].generate.size = { w: 264, h: 148 }; });
  const { code, out, stderr } = runScript(root, "derive-canvas", PLAN);
  assert.equal(code, 0, stderr);
  assert.deepEqual(out.placements[0].canvas, { width: 264, height: 148 });
});

test("a Backdrop over 256 px on an axis has no Pro Flash tier and lists the alternatives, outside the generation count", () => {
  const root = treeWithExample((plan) => { plan.layers[2].placements[0].generate.size = { w: 384, h: 148 }; });
  const { code, out, stderr } = runScript(root, "derive-canvas", PLAN);
  assert.equal(code, 0, stderr);
  assert.deepEqual(out.placements[0].tier, {
    service: null,
    alternatives: [{ service: "pro", generations: 25 }, { service: "pixflux", generations: 1 }, { service: "rd-plus", meteredUsd: 0.06 }],
  });
  assert.equal(out.generations, 5);
});

test("an x, y Placement in a far Layer with its own scale takes that scale", () => {
  const root = treeWithExample((plan) => {
    plan.styleAnchor = null;
    plan.layers = [{ name: "skyline", kind: "placements", plane: "far", scale: 8, placements: [prop("tower", 3, 10)] }];
  });
  const { code, out, stderr } = runScript(root, "derive-canvas", PLAN);
  assert.equal(code, 0, stderr);
  assert.equal(out.placements[0].scale, 8);
  assert.deepEqual(out.placements[0].canvas, { width: 24, height: 80 });
  assert.deepEqual(out.placements[0].tier, { service: "pro-flash", generations: 6 });
});

for (const [w, h, generations] of [[16, 64, 5], [68, 20, 6], [196, 196, 6], [200, 16, 9], [256, 256, 9]] as const) {
  test(`a ${w}x${h} canvas is on the ${generations}-generation Pro Flash tier`, () => {
    const root = treeWithExample((plan) => {
      plan.styleAnchor = null;
      plan.scale = 100;
      plan.layers = [{ name: "room", kind: "placements", plane: "mid", placements: [prop("thing", w / 100, h / 100)] }];
    });
    const { code, out, stderr } = runScript(root, "derive-canvas", PLAN);
    assert.equal(code, 0, stderr);
    assert.deepEqual(out.placements[0].canvas, { width: w, height: h });
    assert.deepEqual(out.placements[0].tier, { service: "pro-flash", generations });
    assert.equal(out.generations, generations);
  });
}

test("a 64x64 Style anchor fits a 256x128 backdrop and does not fit a 48x48 prop", () => {
  const root = treeWithExample((plan) => {
    plan.styleAnchor = "window-wood-large-panes-01";
    plan.layers[3].placements.push(prop("armchair", 1, 1));
  });
  const window = JSON.parse(readFileSync(join(fixtures, "library/elements/window-wood-transparent-panes-01.json"), "utf8"));
  writeJson(root, "library/elements/window-wood-large-panes-01.json", { ...window, id: "window-wood-large-panes-01", width: 64, height: 64 });
  const { code, out, stderr } = runScript(root, "derive-canvas", PLAN);
  assert.equal(code, 0, stderr);
  const fit = Object.fromEntries(out.placements.map((p: any) => [p.placement, [p.canvas, p.anchorFits]]));
  assert.deepEqual(fit.skyline, [{ width: 256, height: 128 }, true]);
  assert.deepEqual(fit.armchair, [{ width: 48, height: 48 }, false]);
});

test("derive-canvas lists nothing for a plan whose generate blocks are all resolved", () => {
  const { code, out } = runScript(makeTree(), "derive-canvas", "scenes/fixture-rainy-desk-a1b2/scene.json");
  assert.equal(code, 0);
  assert.deepEqual(out.placements, []);
});

for (const [what, args, edit, message] of [
  ["no plan is given", [], undefined, /usage/],
  ["the plan does not exist", ["scenes/nope/scene.json"], undefined, /nope\/scene\.json/],
  ["the plan fails its schema", [PLAN], (plan: any) => { plan.scale = "big"; }, /scale/],
  ["the Style anchor is not in the Element library", [PLAN], (plan: any) => { plan.styleAnchor = "lamp-brass-desk-01"; }, /lamp-brass-desk-01 is not in the Element library/],
] as const) {
  test(`derive-canvas exits non-zero with one JSON object when ${what}`, () => {
    const { code, out, stderr } = runScript(treeWithExample(edit), "derive-canvas", ...args);
    assert.equal(code, 1);
    assert.equal(out.ok, false);
    assert.match(out.error, message);
    assert.match(stderr, message);
  });
}
