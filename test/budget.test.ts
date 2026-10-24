import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { editJson, fixtures, makeTree, repo, writeJson } from "./helpers.ts";
import { runScript, startFixtureServer, type FixtureServer } from "./fixture-server.ts";
import { pixellabState } from "./fixtures/services/pixellab.ts";

const PLAN = "scenes/rainy-desk-night-k7f2/scene.json";
const element = join(repo, "pipeline/generate-element.ts");
const budgetScript = join(repo, "pipeline/budget.ts");

let server: FixtureServer;
before(async () => { server = await startFixtureServer(); });
after(() => server.close());
beforeEach(() => pixellabState.reset());

function tree(): string {
  const root = makeTree();
  writeJson(root, PLAN, JSON.parse(readFileSync(join(fixtures, "spec-example-scene.json"), "utf8")));
  return root;
}

const generate = (root: string, ...args: string[]) => runScript(element, [PLAN, ...args], { cwd: root, env: server.env });
async function budget(root: string) {
  const result = await runScript(budgetScript, [PLAN], { cwd: root, env: server.env });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return result.json;
}

test("a fresh plan's cap is 3x the first-Attempt estimate: each still's Pro Flash tier plus 1 per PixelLab strip", async () => {
  const report = await budget(tree());
  assert.deepEqual(report.pixellabGenerations, { charged: 0, pending: 0, used: 0, estimate: 15, cap: 45 });
  assert.deepEqual(report.meteredUsd, { used: 0, cap: 1 });
  assert.deepEqual(report.stills, [
    { placement: "skyline", element: "skyline-night-warm-windows-01", attempts: 0, cap: 4 },
    { placement: "cat", element: "cat-tabby-asleep-01", attempts: 0, cap: 4 },
  ]);
  assert.deepEqual(report.capsHit, []);
});

test("a Backdrop over 256 px is estimated at Pro's 25 generations and a prop in a far Layer by its Layer's scale", async () => {
  const root = tree();
  editJson(root, PLAN, (plan) => {
    plan.layers[2].placements[0].generate.size = { w: 384, h: 148 };
    plan.layers[2].scale = 64;
    plan.layers[2].placements.push({ id: "tower", element: "tower-glass-tall-01", x: 0, y: 0,
      generate: { kind: "prop", brief: "glass tower", realSize: { w: 1, h: 4 }, tags: ["tower"] } });
  });
  const report = await budget(root);
  assert.equal(report.pixellabGenerations.estimate, 25 + 9 + 5 + 1);
});

test("uncharged Attempts count as used, and an accepted Element stays in the estimate", async () => {
  const root = tree();
  await generate(root, "cat");
  const second = await generate(root, "cat");
  let report = await budget(root);
  assert.deepEqual(report.pixellabGenerations, { charged: 0, pending: 10, used: 10, estimate: 15, cap: 45 });
  assert.equal(report.stills.find((s: any) => s.placement === "cat").attempts, 2);

  await generate(root, "cat", "--accept", second.json.scratch.png);
  report = await budget(root);
  assert.deepEqual(report.pixellabGenerations, { charged: 10, pending: 0, used: 10, estimate: 15, cap: 45 });
  assert.deepEqual(report.stills.map((s: any) => s.placement), ["skyline"]);
});

test("an approved overage raises the caps and metered spend is read from the plan", async () => {
  const root = tree();
  editJson(root, PLAN, (plan) => {
    plan.cost.meteredUsd = { "stable-audio-3": 0.08, "fal-elevenlabs": 0.044 };
    plan.cost.approvedOverage = { reason: "five Retro Diffusion strips", pixellabGenerations: 10, meteredUsd: 0.5 };
  });
  const report = await budget(root);
  assert.deepEqual(report.pixellabGenerations, { charged: 0, pending: 0, used: 0, estimate: 15, cap: 55 });
  assert.deepEqual(report.meteredUsd, { used: 0.124, cap: 1.5 });
});

test("four Attempts on one still and a spent generation budget are reported as caps hit", async () => {
  const root = tree();
  for (let k = 0; k < 4; k++) await generate(root, "cat");
  editJson(root, PLAN, (plan) => { plan.cost.pixellabGenerations = 25; });
  const report = await budget(root);
  assert.deepEqual(report.capsHit, [
    "cat (cat-tabby-asleep-01) has had 4 of 4 Attempts",
    "PixelLab generations: 45 used of 45",
  ]);
});

test("generate-element refuses a fifth Attempt on one still without calling PixelLab", async () => {
  const root = tree();
  for (let k = 0; k < 4; k++) assert.equal((await generate(root, "cat")).code, 0);
  const fifth = await generate(root, "cat");
  assert.equal(fifth.code, 1);
  assert.match(fifth.json.error, /cat \(cat-tabby-asleep-01\) has had 4 of 4 Attempts; abandon it/);
  assert.equal(pixellabState.created, 4);
});

test("generate-element refuses any Attempt once the Scene's generation budget is spent", async () => {
  const root = tree();
  editJson(root, PLAN, (plan) => { plan.cost.pixellabGenerations = 45; });
  const result = await generate(root, "skyline");
  assert.equal(result.code, 1);
  assert.match(result.json.error, /Scene budget reached: PixelLab generations: 45 used of 45/);
  assert.equal(pixellabState.created, 0);
});

test("a local Finish adds nothing to the estimate, before or after it is drawn", async () => {
  const root = tree();
  editJson(root, PLAN, (plan) => {
    plan.layers[3].placements.push({ id: "rug", element: "rug-plain-grey-01", x: 0, y: 0,
      generate: { kind: "prop", brief: "plain rug", realSize: { w: 1, h: 0.5 }, tags: ["rug"], finish: "local", generator: "rect", params: { fill: 3 } } });
  });
  assert.equal((await budget(root)).pixellabGenerations.estimate, 15);
  const drawn = await runScript(join(repo, "pipeline/draw-element.ts"), [PLAN, "rug"], { cwd: root, env: server.env });
  assert.equal(drawn.code, 0, drawn.stderr);
  const report = await budget(root);
  assert.equal(report.pixellabGenerations.estimate, 15);
  assert.equal(report.pixellabGenerations.used, 0);
});
