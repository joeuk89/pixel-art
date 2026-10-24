import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { editJson, fixtureScene, makeTree, runScript, writeJson } from "./helpers.ts";

const NAMES = ["generate blocks resolved", "validate", "loop seam", "poster", "stub", "gallery", "tests"];

export function sceneTree(tests: "pass" | "fail" = "pass"): string {
  const root = makeTree();
  writeJson(root, "package.json", { private: true, scripts: { test: `node -e "process.exit(${tests === "pass" ? 0 : 1})"` } });
  assert.equal(runScript(root, "poster", fixtureScene).code, 0);
  assert.equal(runScript(root, "stage", fixtureScene).code, 0);
  return root;
}

const failed = (out: any) => out.checks.filter((c: any) => !c.ok).map((c: any) => c.name);
const problems = (out: any, name: string) => out.checks.find((c: any) => c.name === name).problems;

test("a finished Scene passes every hard check and changes no file", () => {
  const root = sceneTree();
  const before = readFileSync(join(root, fixtureScene), "utf8");
  const { code, out, stderr } = runScript(root, "check-scene", fixtureScene);
  assert.equal(code, 0, stderr + JSON.stringify(out));
  assert.equal(out.ok, true);
  assert.equal(out.scene, "fixture-rainy-desk-a1b2");
  assert.deepEqual(out.checks.map((c: any) => c.name), NAMES);
  assert.deepEqual(failed(out), []);
  assert.equal(readFileSync(join(root, fixtureScene), "utf8"), before);
});

test("an unresolved generate block fails the run and names the Placement", () => {
  const root = sceneTree();
  editJson(root, fixtureScene, (plan) => {
    plan.status = "draft";
    plan.layers[2].placements[0].generate = { kind: "prop", brief: "wooden window", realSize: { w: 1, h: 1 }, tags: ["window"] };
  });
  const { code, out } = runScript(root, "check-scene", fixtureScene);
  assert.equal(code, 1);
  assert.equal(out.ok, false);
  assert.deepEqual(failed(out), ["generate blocks resolved", "validate", "gallery"]);
  assert.deepEqual(problems(out, "generate blocks resolved"), ["window (window-wood-transparent-panes-01) still has a generate block"]);
});

test("an unmeasured loop seam fails", () => {
  const root = sceneTree();
  editJson(root, fixtureScene, (plan) => { plan.status = "draft"; delete plan.soundtrack.music.seam; });
  const { code, out } = runScript(root, "check-scene", fixtureScene);
  assert.equal(code, 1);
  assert.ok(failed(out).includes("loop seam"));
  assert.deepEqual(problems(out, "loop seam"), ["music loop seam is not measured"]);
});

test("a Poster that no longer matches the plan fails", () => {
  const root = sceneTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[2].placements[0].x += 3; });
  const { code, out } = runScript(root, "check-scene", fixtureScene);
  assert.equal(code, 1);
  assert.deepEqual(failed(out), ["poster"]);
  assert.match(problems(out, "poster")[0], /poster\.png differs from frame 0 of the plan in \d+ pixels; run poster/);
});

test("a stub and gallery written before a title change fail", () => {
  const root = sceneTree();
  editJson(root, fixtureScene, (plan) => { plan.title = "Renamed desk"; });
  const { code, out } = runScript(root, "check-scene", fixtureScene);
  assert.equal(code, 1);
  assert.deepEqual(failed(out), ["stub", "gallery"]);
  assert.deepEqual(problems(out, "stub"), ["scenes/fixture-rainy-desk-a1b2/index.html is not what stage writes; run stage"]);
  assert.deepEqual(problems(out, "gallery"), ["gallery.json is not what stage writes; run stage"]);
});

test("a gallery without the Scene fails", () => {
  const root = sceneTree();
  writeFileSync(join(root, "gallery.json"), "[]\n");
  const { code, out } = runScript(root, "check-scene", fixtureScene);
  assert.equal(code, 1);
  assert.deepEqual(failed(out), ["gallery"]);
});

test("failing tests fail the run", () => {
  const root = sceneTree("fail");
  const { code, out } = runScript(root, "check-scene", fixtureScene);
  assert.equal(code, 1);
  assert.deepEqual(failed(out), ["tests"]);
  assert.match(problems(out, "tests")[0], /npm test exited 1/);
});
