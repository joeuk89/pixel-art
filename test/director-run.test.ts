import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { editJson, fixturePalette, makeTree, readJson, repo, writeJson } from "./helpers.ts";
import { runScript, startFixtureServer, type FixtureServer } from "./fixture-server.ts";
import { pixellabState } from "./fixtures/services/pixellab.ts";
import sharp from "sharp";

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
  stage: { back: { x: 48, y: 26, w: 288, h: 190 }, vanishingPoint: { x: 190, y: 118 }, f: 150 },
  layers: [
    { name: "sky", kind: "fill", plane: "far", colour: 1 },
    { name: "city", kind: "placements", plane: "far", placements: [
      { id: "skyline", element: "skyline-rainy-roofs-01", x: 64, y: 40,
        generate: { kind: "backdrop", brief: "distant rooftops at night", tags: ["skyline", "night"], size: { w: 256, h: 128 } } }] },
    { name: "shell", kind: "room", plane: "mid",
      surfaces: {
        back: { colour: 2 },
        floor: { colour: 14, lines: { pattern: "boards", spacing: 8 } },
        left: { colour: 3, skirting: { height: 4, colour: 1 } },
        right: { colour: 3, skirting: { height: 4, colour: 1 } } },
      openings: [{ id: "window", surface: "back", along: 16, across: 14, w: 256, h: 128, frame: { width: 2, colour: 1, mullionsAcross: 1, mullionsDown: 0 } }],
      placements: [
        { id: "painting", element: "painting-harbour-dusk-01", surface: "left", along: 4, across: 40,
          generate: { kind: "prop", brief: "framed painting of a harbour at dusk, front view, flat on", realSize: { w: 0.6, h: 0.7 }, tags: ["painting"] } }] },
    { name: "room", kind: "placements", plane: "mid", placements: [
      { id: "lamp", element: "lamp-brass-floor-01", foot: { x: 120, y: 230 },
        generate: { kind: "prop", brief: "brass floor lamp with a linen shade", realSize: { w: 0.5, h: 1.4 }, tags: ["lamp"] } },
      { id: "desk", element: "desk-oak-plain-01", foot: { x: 200, y: 224 },
        generate: { kind: "prop", brief: "plain oak desk with two drawers, front view", realSize: { w: 1.2, h: 0.75 }, tags: ["desk"], finish: "local", generator: "box", params: { fill: 13, top: 12, drawers: 2 } } },
      { id: "cat", element: "cat-grey-asleep-01", foot: { x: 290, y: 236 }, animation: { fps: 4 },
        generate: { kind: "prop", brief: "grey cat asleep, curled up", realSize: { w: 0.5, h: 0.25 }, tags: ["cat"], strip: { service: "pixellab" } } }] },
  ],
  primitives: [{ type: "rain", region: { x: 66, y: 42, w: 252, h: 124 }, colours: [4, 5] }],
  variants: [{ id: "night", title: "Night", ambient: { level: -2.5 },
    lights: [{ type: "point", id: "lamp", anchor: "lamp", offset: { x: 14, y: 20 }, radius: 130, strength: 2.5, tint: "warm", flicker: { depth: 0.1, rate: 0.8 }, halo: { colour: 8, radius: 24, strength: 0.5 } }],
    emissiveOff: [] }],
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
  assert.equal(attempt.gate.ok, true, JSON.stringify(attempt.gate));
  return (await step(root, "generate-element", PLAN, placement, "--accept", attempt.scratch.png, ...acceptFlags)).element;
}

async function drawn(root: string, placement: string): Promise<string> {
  const attempt = await step(root, "draw-element", PLAN, placement);
  assert.equal(attempt.gate.ok, true, JSON.stringify(attempt.gate));
  return (await step(root, "draw-element", PLAN, placement, "--accept", attempt.scratch.png)).element;
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

// Step 9 of the spec for every Placement still carrying a generate block, then step 10.
async function generateAll(root: string) {
  await step(root, "room-shell", PLAN);
  const [, anchor, desk] = await Promise.all([step(root, "music", PLAN), element(root, "lamp", "--style-anchor"), drawn(root, "desk")]);
  await step(root, "ambient", PLAN);
  const [skyline, painting, cat] = await Promise.all([element(root, "skyline"), element(root, "painting"), element(root, "cat")]);
  await strip(root, cat);
  return { anchor, desk, skyline, painting, cat };
}

const placements = (plan: any) => Object.fromEntries(plan.layers.flatMap((l: any) => l.placements ?? []).map((p: any) => [p.id, p]));
const bytes = (root: string, id: string) => ["json", "png"].map((ext) => readFileSync(join(root, `library/elements/${id}.${ext}`)));
const sceneFile = (root: string, path: string) => readFileSync(join(root, `scenes/${ID}`, path));
const unresolved = async (root: string) => (await step(root, "derive-canvas", PLAN)).placements.map((p: any) => p.placement).sort();

test("from a yes at the Plan gate a v2 plan is generated, checked and staged with a preview and a Tuner URL", async () => {
  const root = tree();
  const { anchor, desk, skyline, painting, cat } = await generateAll(root);

  const first = await finish(root);
  assert.equal(first.ok, true, JSON.stringify(first.checks));
  assert.equal(first.previewUrl, `http://localhost:8000/scenes/${ID}/`);
  assert.equal(first.tuner.url, "http://127.0.0.1:8001/");
  assert.equal(first.tuner.command, `node pipeline/tune.ts ${PLAN}`);
  const plan = readJson(root, PLAN);
  assert.equal(plan.status, "resolved");
  assert.equal(plan.styleAnchor, anchor);

  const deskRecord = readJson(root, `library/elements/${desk}.json`);
  assert.deepEqual([deskRecord.service, deskRecord.generator, deskRecord.width, deskRecord.height], ["local", "box", 64, 40]);
  assert.equal(deskRecord.cost.pixellabGenerations, 0);
  const skylineRecord = readJson(root, `library/elements/${skyline}.json`);
  assert.deepEqual([skylineRecord.kind, skylineRecord.width, skylineRecord.height, skylineRecord.model], ["backdrop", 256, 128, "pro-flash"]);
  for (const id of [anchor, skyline, painting, cat]) assert.equal(readJson(root, `library/elements/${id}.json`).service, "pixellab");

  const room = await sharp(sceneFile(root, "room.png")).metadata();
  assert.deepEqual([room.width, room.height], [384, 240]);
  const feature = await sharp(sceneFile(root, "features/painting.png")).metadata();
  assert.ok(feature.width! > 0 && feature.height! > 0);
  for (const f of ["room.png", "features/painting.png", "poster.png", "index.html", "scene.json"]) assert.ok(first.staged.includes(`scenes/${ID}/${f}`), `${f} is staged`);
  assert.equal(plan.cost.pixellabGenerations, 4 * 5 + 1, "the fixture charges 5 per still and 1 per strip; the local desk is free");
  assert.equal(git(root, "rev-list", "--count", "HEAD").trim(), "1");
});

test("a rejected Element resumes at the Plan gate for that Placement only, and every other Placement keeps its Element", async () => {
  const root = tree();
  const ids = await generateAll(root);
  assert.equal((await finish(root)).ok, true);
  const before = placements(readJson(root, PLAN));
  const kept = Object.fromEntries(Object.entries(ids).filter(([k]) => k !== "cat").map(([k, id]) => [k, bytes(root, id)]));
  const shell = { room: sceneFile(root, "room.png"), painting: sceneFile(root, "features/painting.png") };

  await step(root, "reopen", PLAN, "cat");
  assert.deepEqual(await unresolved(root), ["cat"]);
  const newCat = await element(root, "cat");
  await strip(root, newCat);
  const second = await finish(root);
  assert.equal(second.ok, true, JSON.stringify(second.checks));

  const after = readJson(root, PLAN);
  assert.equal(after.status, "resolved");
  const now = placements(after);
  assert.equal(now.cat.element, "cat-grey-asleep-02");
  assert.deepEqual({ ...now, cat: undefined }, { ...before, cat: undefined });
  for (const [k, id] of Object.entries(ids)) if (k !== "cat") assert.deepEqual(bytes(root, id), kept[k], `${id} is untouched`);
  assert.deepEqual(bytes(root, ids.cat).length, 2, "the replaced Element stays in the library");
  assert.deepEqual(sceneFile(root, "room.png"), shell.room);
  assert.deepEqual(sceneFile(root, "features/painting.png"), shell.painting);
  assert.deepEqual(readdirSync(join(root, "scenes")).sort(), ["fixture-rainy-desk-a1b2", ID], "no second Scene folder");
});

test("after a rejection, preview no longer reports a strip fallback for a Placement that was reopened and regenerated", async () => {
  const root = tree();
  await step(root, "room-shell", PLAN);
  await element(root, "lamp", "--style-anchor");
  await drawn(root, "desk");
  await step(root, "music", PLAN);
  await step(root, "ambient", PLAN);
  await element(root, "skyline");
  await element(root, "painting");
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
