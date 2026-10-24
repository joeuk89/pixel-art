import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureScene, makeTree, readJson, runScript, validate } from "./helpers.ts";

const placementIn = (plan: any, id: string) => plan.layers.flatMap((l: any) => l.placements ?? []).find((p: any) => p.id === id);

test("reopen puts a generate block rebuilt from the Element record back on each named Placement and marks the Scene draft", () => {
  const root = makeTree();
  const { code, out, stderr } = runScript(root, "reopen", fixtureScene, "cat", "skyline");
  assert.equal(code, 0, stderr);
  assert.deepEqual(out.reopened, ["cat", "skyline"]);
  assert.deepEqual(out.proposed, { cat: "cat-tabby-asleep-02", skyline: "skyline-night-warm-windows-02" });

  const plan = readJson(root, fixtureScene);
  assert.equal(plan.id, "fixture-rainy-desk-a1b2");
  assert.equal(plan.status, "draft");
  const cat = placementIn(plan, "cat");
  assert.equal(cat.element, "cat-tabby-asleep-02", "a fresh proposed id; the replaced Element stays in the library");
  assert.deepEqual(cat.generate, {
    kind: "prop", brief: "tabby cat asleep, curled up", realSize: { w: 0.5, h: 0.25 }, tags: ["cat", "asleep", "tabby"],
    strip: { service: "pixellab" },
  });
  assert.deepEqual(cat.animation, { fps: 4, order: "pingpong" });
  assert.deepEqual(placementIn(plan, "skyline").generate, { kind: "backdrop", brief: readJson(root, "library/elements/skyline-night-warm-windows-01.json").brief, tags: readJson(root, "library/elements/skyline-night-warm-windows-01.json").tags });
  assert.equal(placementIn(plan, "cat-2").generate, undefined);
  assert.equal(placementIn(plan, "window").generate, undefined);
  assert.equal(validate(root).code, 0);
});

test("reopen refuses an unknown Placement and changes nothing", () => {
  const root = makeTree();
  const before = readFileSync(join(root, fixtureScene), "utf8");
  const { code, out } = runScript(root, "reopen", fixtureScene, "cat", "piano");
  assert.equal(code, 1);
  assert.match(out.error, /no Placement piano/);
  assert.equal(readFileSync(join(root, fixtureScene), "utf8"), before);
});
