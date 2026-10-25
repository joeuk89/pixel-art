import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { editJson, fixtureScene, readJson, runScript } from "./helpers.ts";
import { tuningOf } from "../pipeline/lib/tuning.ts";
import { startTuner, stopTuners, tunerTree } from "./tuner.ts";

const id = "fixture-rainy-desk-a1b2";
const sceneDir = `scenes/${id}`;

after(stopTuners);

const placementsOf = (plan: any) => plan.layers.flatMap((l: any) => l.placements ?? []);
const placement = (plan: any, pid: string) => placementsOf(plan).find((p: any) => p.id === pid);

async function decoded(input: string | Buffer) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

const mugPixels = Buffer.alloc(16 * 16 * 4);
for (let y = 4; y < 16; y++) for (let x = 3; x < 13; x++) mugPixels.set([0xf6, 0xe8, 0xcc, 255], (y * 16 + x) * 4);
const mugPng = await sharp(mugPixels, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer();

// The fixture Scene plus a local-Finish rug on the floor, a small service prop whose canvas stays clamped at 16,
// and a copy of that prop in the top-left corner, which a 1.2x zoom pushes wholly off the canvas.
function prepare(root: string): void {
  const mug = {
    id: "mug-ceramic-plain-01", kind: "prop", width: 16, height: 16, realSize: { w: 0.1, h: 0.1 }, transparent: true,
    subject: "mug", tags: ["mug"], brief: "plain ceramic mug", prompt: "plain ceramic mug", service: "pixellab", model: "pro-flash",
    params: { no_background: true }, seed: 1400, palette: "fixture-night-v2", styleAnchor: null, createdAt: "2026-10-24T20:01:00Z",
    firstScene: id, cost: { pixellabGenerations: 1, meteredUsd: 0 }, checks: { attempt: 1, passed: ["dimensions", "alpha", "palette"], warnings: [] },
  };
  writeFileSync(join(root, "library/elements/mug-ceramic-plain-01.json"), JSON.stringify(mug, null, 2));
  writeFileSync(join(root, "library/elements/mug-ceramic-plain-01.png"), mugPng);
  editJson(root, fixtureScene, (plan) => {
    const room = plan.layers.find((l: any) => l.name === "room");
    room.placements.push(
      { id: "mug", element: "mug-ceramic-plain-01", foot: { x: 230, y: 214 } },
      { id: "mug-2", element: "mug-ceramic-plain-01", x: 0, y: 0, flipX: true },
    );
    const rug = placement(plan, "rug");
    rug.element = "rug-wool-plain-01";
    rug.generate = { kind: "prop", brief: "plain wool rug, front view, flat on", realSize: { w: 1.5, h: 0.4 }, tags: ["rug"], finish: "local", generator: "rect", params: { fill: 13 } };
  });
  const drawn = runScript(root, "draw-element", fixtureScene, "rug");
  assert.equal(drawn.code, 0, drawn.stderr);
  const accepted = runScript(root, "draw-element", fixtureScene, "rug", "--accept", drawn.out.scratch.png);
  assert.equal(accepted.code, 0, accepted.stderr);
}

const zoomTree = () => tunerTree("pass", prepare);

async function save(url: string, body: unknown): Promise<{ status: number; out: any }> {
  const response = await fetch(new URL("save", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, out: await response.json() };
}

test("a zoom below 0.8x, above 1.5x or off a 0.05 step is refused on Save and on the preview endpoints, and nothing is written", async () => {
  const root = zoomTree();
  const before = readFileSync(join(root, fixtureScene));
  const url = await startTuner(root);
  const tuning = tuningOf(readJson(root, fixtureScene));
  for (const zoom of [0.75, 1.55, 1.23]) {
    const { status, out } = await save(url, { ...tuning, zoom });
    assert.equal(status, 400, `zoom ${zoom}: ${JSON.stringify(out)}`);
    assert.match(out.error, /zoom/);
    for (const path of [`room.png?zoom=${zoom}`, `zoom.json?zoom=${zoom}`, `stand-in/window.png?zoom=${zoom}`]) {
      assert.equal((await fetch(new URL(path, url))).status, 400, path);
    }
  }
  assert.match((await save(url, { ...tuning, zoom: 1.6 })).out.error, /outside 0\.8x to 1\.5x/);
  assert.deepEqual(readFileSync(join(root, fixtureScene)), before);
});

test("a zoom Save bakes the Stage, moves Placements and Lights about the vanishing point, reopens what changed size and redraws local work", async () => {
  const root = zoomTree();
  const roomBefore = readFileSync(join(root, sceneDir, "room.png"));
  const rugBefore = await decoded(join(root, sceneDir, "features/rug.png"));
  const url = await startTuner(root);
  const tuning = tuningOf(readJson(root, fixtureScene));

  const { status, out } = await save(url, { ...tuning, zoom: 1.2 });
  assert.equal(status, 200, JSON.stringify(out));
  assert.equal(out.ok, true, out.error);
  const plan = readJson(root, fixtureScene);

  assert.deepEqual(plan.stage, { back: { x: 20, y: 8, w: 345, h: 228 }, vanishingPoint: { x: 190, y: 118 }, f: 180 });
  assert.equal(plan.scale, 57.6);
  assert.deepEqual(placement(plan, "cat").foot, { x: 312, y: 236 });
  assert.deepEqual([placement(plan, "window").x, placement(plan, "window").y], [164, 10]);
  const [lamp, spill, beam] = plan.variants[0].lights;
  assert.equal(lamp.anchor, "window");
  assert.deepEqual(lamp.offset, { x: 149, y: 160 + 32 });
  assert.equal(lamp.radius, 108);
  assert.equal(lamp.halo.radius, 28.8);
  assert.deepEqual(spill.at, { x: 190, y: 39 });
  assert.equal(spill.radius, 100 + 20);
  assert.deepEqual(beam.corners, [{ x: 168, y: 68 }, { x: 216, y: 68 }, { x: 264, y: 260 }, { x: 130, y: 260 }]);

  for (const pid of ["window", "skyline", "painting", "cat", "cat-2"]) {
    assert.ok(placement(plan, pid).generate, `${pid} was not reopened`);
    assert.ok(out.reopened.includes(pid), `${pid} is not listed as reopened`);
  }
  assert.equal(placement(plan, "window").element, "window-wood-transparent-panes-02");
  assert.deepEqual(placement(plan, "skyline").generate.size, { w: 308, h: 156 });
  assert.equal(placement(plan, "mug").generate, undefined);
  assert.equal(placement(plan, "mug").element, "mug-ceramic-plain-01");
  assert.ok(!out.reopened.includes("mug"));

  assert.equal(placement(plan, "mug-2"), undefined);
  assert.deepEqual(out.removed.placements, ["mug-2"]);

  const roomAfter = readFileSync(join(root, sceneDir, "room.png"));
  assert.notDeepEqual(roomAfter, roomBefore);
  assert.equal(runScript(root, "room-shell", fixtureScene).code, 0);
  assert.deepEqual((await decoded(join(root, sceneDir, "room.png"))).data, (await decoded(roomAfter)).data);

  const rug = placement(plan, "rug");
  assert.equal(rug.generate, undefined);
  assert.equal(rug.element, "rug-wool-plain-02");
  const rugRecord = readJson(root, `library/elements/${rug.element}.json`);
  assert.equal(rugRecord.service, "local");
  assert.deepEqual([rugRecord.generator, rugRecord.params.fill], ["rect", 13]);
  const oldRecord = readJson(root, "library/elements/rug-wool-plain-01.json");
  assert.ok(rugRecord.width > oldRecord.width, `rug width ${rugRecord.width} did not grow from ${oldRecord.width}`);
  assert.deepEqual(out.redrawn, [{ placement: "rug", element: "rug-wool-plain-02" }]);
  const rugAfter = await decoded(join(root, sceneDir, "features/rug.png"));
  assert.notDeepEqual([rugAfter.width, rugAfter.height], [rugBefore.width, rugBefore.height]);
  assert.ok(out.features.includes("rug"));

  assert.equal(plan.status, "draft");
  assert.equal(out.status, "draft");
  assert.ok(out.estimate.generations > 0);
  assert.equal(out.estimate.generations, out.estimate.firstAttempt.reduce((sum: number, e: any) => sum + e.generations, 0));
  assert.deepEqual(out.estimate.firstAttempt.map((e: any) => e.placement).sort(), ["cat", "cat-2", "painting", "skyline", "window"]);
  assert.match(out.resume, /step 8/);
  assert.ok(out.resume.includes(fixtureScene));
});

async function fetchPng(url: string, path: string) {
  const response = await fetch(new URL(path, url));
  assert.equal(response.status, 200, `${path}: ${response.status}`);
  assert.equal(response.headers.get("content-type"), "image/png");
  return { kind: response.headers.get("x-stand-in"), image: await decoded(Buffer.from(await response.arrayBuffer())) };
}

test("the stand-in endpoint resamples a service Element and renders a local one exactly as the zoom Save then draws it", async () => {
  const root = zoomTree();
  const url = await startTuner(root);

  const window = await fetchPng(url, "stand-in/window.png?zoom=1.2");
  assert.equal(window.kind, "resampled");
  const source = await decoded(join(root, "library/elements/window-wood-transparent-panes-01.png"));
  assert.deepEqual([window.image.width, window.image.height], [60, 60]);
  // 48 px to 60 px nearest-neighbour: target pixel x reads source pixel floor((x + 0.5) * 48 / 60).
  for (const [x, y] of [[0, 0], [5, 7], [30, 30], [59, 59], [12, 44]]) {
    const sx = Math.floor(((x + 0.5) * 48) / 60), sy = Math.floor(((y + 0.5) * 48) / 60);
    assert.deepEqual([...window.image.data.subarray((y * 60 + x) * 4, (y * 60 + x) * 4 + 4)], [...source.data.subarray((sy * 48 + sx) * 4, (sy * 48 + sx) * 4 + 4)], `pixel ${x},${y}`);
  }

  const cat = await fetchPng(url, "stand-in/cat.strip.png?zoom=1.2");
  assert.equal(cat.kind, "resampled");
  const catRecord = readJson(root, "library/elements/cat-tabby-asleep-01.json");
  assert.equal(cat.image.width % catRecord.animation.frames, 0);

  const rug = await fetchPng(url, "stand-in/rug.png?zoom=1.2");
  assert.equal(rug.kind, "exact");
  const projected = await fetchPng(url, "stand-in/features/rug.png?zoom=1.2");

  const tuning = tuningOf(readJson(root, fixtureScene));
  assert.equal((await save(url, { ...tuning, zoom: 1.2 })).status, 200);
  const drawn = await decoded(join(root, "library/elements/rug-wool-plain-02.png"));
  assert.deepEqual([rug.image.width, rug.image.height], [drawn.width, drawn.height]);
  assert.deepEqual(rug.image.data, drawn.data);
  const feature = await decoded(join(root, sceneDir, "features/rug.png"));
  assert.deepEqual(projected.image.data, feature.data);
});

test("the zoom preview lists each Placement's stand-in and what would fall off the canvas, without writing the plan", async () => {
  const root = zoomTree();
  const before = readFileSync(join(root, fixtureScene));
  const url = await startTuner(root);
  const out = await (await fetch(new URL("zoom.json?zoom=1.2", url))).json();
  assert.equal(out.ok, true);
  assert.deepEqual(out.plan.stage.back, { x: 20, y: 8, w: 345, h: 228 });
  assert.deepEqual(out.removed.placements, ["mug-2"]);
  const kinds = Object.fromEntries(out.placements.map((p: any) => [p.placement, p.standIn]));
  assert.equal(kinds.rug, "exact");
  assert.equal(kinds.window, "resampled");
  assert.equal(kinds.skyline, "resampled");
  const room = await fetch(new URL("room.png?zoom=1.2", url));
  assert.equal(room.status, 200);
  assert.notDeepEqual((await decoded(Buffer.from(await room.arrayBuffer()))).data, (await decoded(join(root, sceneDir, "room.png"))).data);
  assert.deepEqual(readFileSync(join(root, fixtureScene)), before);
});

test("a draft Scene with a Placement still waiting on its Element zooms too, and a pending Backdrop keeps covering its Opening", async () => {
  const root = zoomTree();
  assert.equal(runScript(root, "reopen", fixtureScene, "skyline", "cat").code, 0);
  const url = await startTuner(root);
  const tuning = tuningOf(readJson(root, fixtureScene));
  const { status, out } = await save(url, { ...tuning, zoom: 0.8 });
  assert.equal(status, 200, JSON.stringify(out));
  const plan = readJson(root, fixtureScene);
  assert.deepEqual(placement(plan, "skyline").generate.size, { w: 208, h: 104 });
  assert.ok(!out.reopened.includes("cat") && !out.reopened.includes("skyline"));
  assert.ok(out.reopened.includes("window"));
});
