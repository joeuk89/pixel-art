import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { editJson, fixturePalette, makeTree, readJson, repo, writeJson } from "./helpers.ts";
import { runScript, startFixtureServer, type FixtureServer } from "./fixture-server.ts";
import { pixellabState } from "./fixtures/services/pixellab.ts";

const ID = "lamp-desk-rain-e2e1";
const PLAN = `scenes/${ID}/scene.json`;

let server: FixtureServer;
before(async () => { server = await startFixtureServer(); });
after(() => server.close());
beforeEach(() => pixellabState.reset());

const draft = {
  schemaVersion: 2, id: ID, title: "Lamp desk in the rain", prompt: "a desk lamp on by a rainy window, cat asleep",
  description: "A desk lamp glows by a rainy window while a grey cat sleeps beneath it.",
  createdAt: "2026-10-24T21:00:00Z", seed: 4242, status: "draft", palette: fixturePalette, scale: 48, dither: false, styleAnchor: null,
  layers: [
    { name: "sky", kind: "fill", plane: "far", colour: 1 },
    { name: "city", kind: "placements", plane: "far", placements: [
      { id: "skyline", element: "skyline-rainy-roofs-01", x: 64, y: 30,
        generate: { kind: "backdrop", brief: "distant rooftops at night", tags: ["skyline", "night"], size: { w: 256, h: 96 } } }] },
    { name: "room", kind: "placements", plane: "mid", placements: [
      { id: "lamp", element: "lamp-brass-desk-01", x: 40, y: 140,
        generate: { kind: "prop", brief: "brass desk lamp", realSize: { w: 1, h: 1 }, tags: ["lamp"] } },
      { id: "cat", element: "cat-grey-asleep-01", x: 280, y: 200, animation: { fps: 4 },
        generate: { kind: "prop", brief: "grey cat asleep, curled up", realSize: { w: 0.5, h: 0.25 }, tags: ["cat"], strip: { service: "pixellab" } } }] },
  ],
  primitives: [
    { type: "rain", region: { x: 140, y: 32, w: 104, h: 116 }, colours: [4, 5] },
  ],
  variants: [{ id: "night", title: "Night", ambient: { level: -2.5 }, lights: [], emissiveOff: [] }],
  soundtrack: {
    music: { brief: "slow piano, rain on a window", service: "stable-audio-3" },
    ambient: [{ source: { kind: "curated", id: "freesound-room-tone-641306" }, file: "room.ogg", distance: "mid" }],
    oneshots: [],
  },
  cost: { pixellabGenerations: 0, meteredUsd: {}, attemptsAbandoned: 0, approvedOverage: null },
};

function git(root: string, ...args: string[]): string {
  const run = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

function tree(): string {
  const root = makeTree();
  writeJson(root, "package.json", { private: true, scripts: { test: "node -e \"process.exit(0)\"" } });
  git(root, "init", "-q");
  git(root, "add", "library", "package.json");
  git(root, "commit", "-qm", "library");
  writeJson(root, PLAN, draft);
  return root;
}

async function step(root: string, script: string, ...args: string[]) {
  const run = await runScript(join(repo, "pipeline", `${script}.ts`), args, { cwd: root, env: { ...server.env, STABILITY_POLL_MS: "10" } });
  assert.equal(run.code, 0, `${script} ${args.join(" ")}: ${run.stdout}${run.stderr}`);
  return run.json;
}

async function element(root: string, placement: string, ...acceptFlags: string[]): Promise<string> {
  const attempt = await step(root, "generate-element", PLAN, placement);
  assert.equal(attempt.gate.ok, true);
  return (await step(root, "generate-element", PLAN, placement, "--accept", attempt.scratch.png, ...acceptFlags)).element;
}

async function strip(root: string, id: string): Promise<void> {
  const attempt = await step(root, "generate-strip", id, "--scene", PLAN);
  assert.equal(attempt.gate.ok, true, JSON.stringify(attempt.gate));
  await step(root, "generate-strip", id, "--accept", attempt.scratch.strip, "--scene", PLAN);
}

async function finish(root: string) {
  await step(root, "poster", PLAN);
  await step(root, "stub", PLAN);
  return step(root, "preview", PLAN);
}

const placements = (plan: any) => Object.fromEntries(plan.layers.flatMap((l: any) => l.placements ?? []).map((p: any) => [p.id, p]));
const bytes = (root: string, id: string) => ["json", "png"].map((ext) => readFileSync(join(root, `library/elements/${id}.${ext}`)));

test("from a yes at the Plan gate the scripts take a draft to a staged Scene, and a rejection regenerates only the changed Placement", async () => {
  const root = tree();

  const [, anchor] = await Promise.all([step(root, "music", PLAN), element(root, "lamp", "--style-anchor")]);
  assert.equal(anchor, "lamp-brass-desk-01");
  await step(root, "ambient", PLAN);
  const [skyline, cat] = await Promise.all([element(root, "skyline"), element(root, "cat")]);
  await strip(root, cat);

  const first = await finish(root);
  assert.equal(first.ok, true);
  assert.equal(first.previewUrl, `http://localhost:8000/scenes/${ID}/`);
  const plan = readJson(root, PLAN);
  assert.equal(plan.status, "resolved");
  assert.equal(plan.styleAnchor, "lamp-brass-desk-01");
  for (const id of [anchor, skyline, cat]) {
    const record = readJson(root, `library/elements/${id}.json`);
    assert.ok(record.checks && record.cost && "styleAnchor" in record, `${id} has checks, cost and styleAnchor`);
  }
  assert.equal(readJson(root, `library/elements/${skyline}.json`).styleAnchor, "lamp-brass-desk-01");
  assert.equal(plan.cost.pixellabGenerations, 3 * 5 + 1, "the fixture charges 5 per still and 1 per strip");
  assert.deepEqual(first.elements.generated, [skyline, anchor, cat]);
  assert.equal(git(root, "rev-list", "--count", "HEAD").trim(), "1");

  const kept = { skyline: bytes(root, skyline), lamp: bytes(root, anchor), oldCat: bytes(root, cat) };
  const before = placements(plan);

  await step(root, "reopen", PLAN, "cat");
  const newCat = await element(root, "cat");
  await strip(root, newCat);
  const second = await finish(root);
  assert.equal(second.ok, true);

  const after = readJson(root, PLAN);
  assert.equal(after.id, ID);
  const now = placements(after);
  assert.equal(now.cat.element, "cat-grey-asleep-02");
  assert.deepEqual({ ...now, cat: undefined }, { ...before, cat: undefined });
  assert.deepEqual({ ...now.cat, element: undefined }, { ...before.cat, element: undefined });
  assert.equal(after.styleAnchor, "lamp-brass-desk-01");
  assert.deepEqual(bytes(root, skyline), kept.skyline);
  assert.deepEqual(bytes(root, anchor), kept.lamp);
  assert.deepEqual(bytes(root, cat), kept.oldCat, "the replaced Element stays in the library");
  assert.equal(after.cost.pixellabGenerations, 16 + 5 + 1);
  assert.ok(second.staged.includes(`library/elements/${newCat}.png`));
  assert.deepEqual(readdirSync(join(root, "scenes")).sort(), ["fixture-rainy-desk-a1b2", ID], "no second Scene folder");
  assert.ok(existsSync(join(root, `scenes/${ID}/index.html`)));
});

test("after a rejection, preview no longer reports a strip fallback for a Placement that was reopened and regenerated", async () => {
  const root = tree();
  await element(root, "lamp", "--style-anchor");
  await step(root, "music", PLAN);
  await step(root, "ambient", PLAN);
  await element(root, "skyline");
  const cat = await element(root, "cat");
  await step(root, "generate-strip", cat, "--scene", PLAN);
  await step(root, "generate-strip", cat, "--abandon", "--scene", PLAN);

  const first = await finish(root);
  assert.deepEqual(first.abandoned, [{ placement: "cat", element: cat, attempts: 1, outcome: "still" }]);
  assert.match(first.commitMessage, /Still only, no Frame strip: cat-grey-asleep-01 \(cat\)/);

  await step(root, "reopen", PLAN, "cat");
  editJson(root, PLAN, (plan) => {
    const reopened = placements(plan).cat;
    reopened.generate.strip = { service: "pixellab" };
    reopened.animation = { fps: 4 };
  });
  const newCat = await element(root, "cat");
  await strip(root, newCat);
  const second = await finish(root);
  assert.equal(second.ok, true);
  assert.deepEqual(second.abandoned, []);
  assert.doesNotMatch(second.commitMessage, /Still only/);
});
