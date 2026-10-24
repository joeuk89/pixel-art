import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fixtures, makeTree, readJson, validate, writeJson } from "./helpers.ts";

const SCENE = "scenes/fixture-primitives-c3d4/scene.json";
const catalogue = () => readJson(join(fixtures, "primitives"), "scene.json");

function treeWith(edit: (plan: any) => void = () => {}): string {
  const root = makeTree();
  const plan = catalogue();
  edit(plan);
  writeJson(root, SCENE, plan);
  return root;
}

function errorsFor(root: string): any[] {
  return validate(root).report.errors.filter((e: any) => e.file === SCENE);
}

test("validate accepts all six Primitives with every parameter set", () => {
  const root = treeWith();
  const { code, report } = validate(root);
  assert.deepEqual(report.errors, []);
  assert.equal(code, 0);
  assert.deepEqual(catalogue().primitives.map((p: any) => p.type), ["rain", "snow", "glow", "steam", "twinkle", "blink"]);
});

test("validate accepts all six Primitives with only their required parameters", () => {
  const required: Record<string, string[]> = {
    rain: ["type", "region", "colours"],
    snow: ["type", "region", "colours"],
    glow: ["type", "anchor", "offset", "colour"],
    steam: ["type", "anchor", "offset", "colours"],
    twinkle: ["type", "anchor", "colours"],
    blink: ["type", "anchor", "swaps"],
  };
  const root = treeWith((plan) => {
    plan.primitives = plan.primitives.map((p: any) => Object.fromEntries(required[p.type].map((k) => [k, p[k]])));
  });
  const { code, report } = validate(root);
  assert.deepEqual(report.errors, []);
  assert.equal(code, 0);
});

test("validate rejects an unknown Primitive type", () => {
  const root = treeWith((plan) => plan.primitives.push({ type: "fog", region: { x: 0, y: 0, w: 10, h: 10 }, colours: [1] }));
  assert.equal(validate(root).code, 1);
  assert.ok(errorsFor(root).some((e) => e.path === "primitives[6].type"), JSON.stringify(errorsFor(root)));
});

test("a Primitive anchored to a Placement the plan does not have keeps a draft pending and fails a resolved Scene", () => {
  const draft = validate(treeWith((plan) => { plan.primitives[3].anchor = "teapot"; }));
  const scene = draft.report.scenes.find((s: any) => s.file === SCENE);
  assert.equal(scene.status, "draft");
  assert.match(scene.pending.find((p: any) => p.path === "primitives[3].anchor")?.message ?? "", /no Placement teapot/);

  const root = treeWith((plan) => { plan.primitives[3].anchor = "teapot"; plan.status = "resolved"; });
  assert.equal(validate(root).code, 1);
  assert.match(errorsFor(root).find((e) => e.path === "primitives[3].anchor")?.message ?? "", /declared resolved but no Placement teapot/);
});

test("validate rejects a Primitive colour index beyond the Scene's Palette", () => {
  const root = treeWith((plan) => {
    plan.primitives[0].colours = [6, 16];
    plan.primitives[2].pool.colour = 20;
    plan.primitives[5].swaps = [[10, 17]];
  });
  assert.equal(validate(root).code, 1);
  const paths = errorsFor(root).filter((e) => /not in Palette cosy-night/.test(e.message)).map((e) => e.path);
  assert.deepEqual(paths, ["primitives[0].colours[1]", "primitives[2].pool.colour", "primitives[5].swaps[0][1]"]);
});

test("validate rejects blink longFrames whose minimum exceeds its maximum", () => {
  const root = treeWith((plan) => { plan.primitives[5].longFrames = [9, 4]; });
  assert.equal(validate(root).code, 1);
  assert.ok(errorsFor(root).some((e) => e.path === "primitives[5].longFrames"), JSON.stringify(errorsFor(root)));
});
