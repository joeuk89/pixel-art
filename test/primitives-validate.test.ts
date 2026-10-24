import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fixtures, makeTree, readJson, validate, writeJson } from "./helpers.ts";
import { primitiveSchema } from "../schema/index.ts";

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

test("validate accepts all eight Primitives with every parameter set", () => {
  const root = treeWith();
  const { code, report } = validate(root);
  assert.deepEqual(report.errors, []);
  assert.equal(code, 0);
  assert.deepEqual(catalogue().primitives.map((p: any) => p.type), ["rain", "snow", "steam", "twinkle", "blink", "dust", "sway", "birds"]);
});

test("validate accepts all eight Primitives with only their required parameters", () => {
  const required: Record<string, string[]> = {
    rain: ["type", "region", "colours"],
    snow: ["type", "region", "colours"],
    steam: ["type", "anchor", "offset", "colours"],
    twinkle: ["type", "anchor", "colours"],
    blink: ["type", "anchor", "swaps"],
    dust: ["type", "region", "colours"],
    sway: ["type", "anchor", "region", "colours"],
    birds: ["type", "region", "colours"],
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
  assert.ok(errorsFor(root).some((e) => e.path === "primitives[8].type"), JSON.stringify(errorsFor(root)));
});

test("a Primitive anchored to a Placement the plan does not have keeps a draft pending and fails a resolved Scene", () => {
  const draft = validate(treeWith((plan) => { plan.primitives[2].anchor = "teapot"; }));
  const scene = draft.report.scenes.find((s: any) => s.file === SCENE);
  assert.equal(scene.status, "draft");
  assert.match(scene.pending.find((p: any) => p.path === "primitives[2].anchor")?.message ?? "", /no Placement teapot/);

  const root = treeWith((plan) => { plan.primitives[2].anchor = "teapot"; plan.status = "resolved"; });
  assert.equal(validate(root).code, 1);
  assert.match(errorsFor(root).find((e) => e.path === "primitives[2].anchor")?.message ?? "", /declared resolved but no Placement teapot/);
});

test("validate rejects a Primitive colour index beyond the Scene's Palette", () => {
  const root = treeWith((plan) => {
    plan.primitives[0].colours = [6, 16];
    plan.primitives[2].colours = [20];
    plan.primitives[4].swaps = [[10, 17]];
  });
  assert.equal(validate(root).code, 1);
  const paths = errorsFor(root).filter((e) => /not in Palette fixture-night-v2/.test(e.message)).map((e) => e.path);
  assert.deepEqual(paths, ["primitives[0].colours[1]", "primitives[2].colours[0]", "primitives[4].swaps[0][1]"]);
});

test("validate rejects birds whose shortest gap exceeds its longest", () => {
  const root = treeWith((plan) => { plan.primitives[7].every = [30, 10]; });
  assert.equal(validate(root).code, 1);
  assert.ok(errorsFor(root).some((e) => e.path === "primitives[7].every"), JSON.stringify(errorsFor(root)));
});

test("validate rejects blink longFrames whose minimum exceeds its maximum", () => {
  const root = treeWith((plan) => { plan.primitives[4].longFrames = [9, 4]; });
  assert.equal(validate(root).code, 1);
  assert.ok(errorsFor(root).some((e) => e.path === "primitives[4].longFrames"), JSON.stringify(errorsFor(root)));
});

test("each Primitive type defaults emissive as the spec sets it, and an explicit value overrides it", () => {
  const expected: Record<string, boolean> = {
    rain: false, snow: false, steam: true, twinkle: true, blink: true, dust: false, sway: false, birds: false,
  };
  for (const primitive of catalogue().primitives) {
    const { emissive: _, ...bare } = primitive;
    const want = expected[primitive.type];
    assert.equal(primitiveSchema.parse(bare).emissive, want, `${primitive.type} default`);
    assert.equal(primitiveSchema.parse({ ...bare, emissive: !want }).emissive, !want, `${primitive.type} override`);
  }
});
