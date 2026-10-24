import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { createCompositor, type ElementPixels } from "../viewer/compositor.ts";
import { editJson, fixtureScene, fixtures, makeTree, readJson, repo } from "./helpers.ts";

const sceneDir = "scenes/fixture-rainy-desk-a1b2";

function poster(root: string, ...args: string[]) {
  const run = spawnSync(process.execPath, [join(repo, "pipeline/poster.ts"), ...args], { cwd: root, encoding: "utf8" });
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
}

async function rgba(path: string) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

async function fixtureFrameZero(root: string): Promise<Uint8ClampedArray> {
  const plan = readJson(root, fixtureScene);
  const palette = readJson(root, `library/palettes/${plan.palette}.json`);
  const elements = new Map<string, ElementPixels>();
  for (const id of ["skyline-night-warm-windows-01", "window-wood-transparent-panes-01", "cat-tabby-asleep-01"]) {
    const record = readJson(root, `library/elements/${id}.json`);
    const still = await rgba(join(root, `library/elements/${id}.png`));
    const strip = record.animation && {
      image: await rgba(join(root, `library/elements/${id}.strip.png`)),
      frames: record.animation.frames,
      fps: record.animation.fps,
      order: record.animation.order,
    };
    elements.set(id, strip ? { still, strip } : { still });
  }
  return createCompositor({ plan, elements, palette }).render(0);
}

test("poster run against the fixture Scene prints one JSON object, exits 0 and writes both PNGs beside the plan", async () => {
  const root = makeTree();
  rmSync(join(root, sceneDir, "poster.png"));
  const { code, stdout, stderr } = poster(root, fixtureScene);
  assert.equal(code, 0, stderr);
  const report = JSON.parse(stdout);
  assert.deepEqual(report, {
    ok: true,
    scene: "fixture-rainy-desk-a1b2",
    poster: `${sceneDir}/poster.png`,
    og: `${sceneDir}/poster-og.png`,
  });
  const small = await sharp(join(root, sceneDir, "poster.png")).metadata();
  const og = await sharp(join(root, sceneDir, "poster-og.png")).metadata();
  assert.deepEqual([small.format, small.width, small.height], ["png", 192, 120]);
  assert.deepEqual([og.format, og.width, og.height], ["png", 768, 480]);
});

test("the 192x120 Poster equals the compositor's frame 0 with Primitives off", async () => {
  const root = makeTree();
  assert.equal(poster(root, fixtureScene).code, 0);
  const written = await rgba(join(root, sceneDir, "poster.png"));
  assert.deepEqual(Buffer.from(written.data), Buffer.from(await fixtureFrameZero(root)));
});

test("the Open Graph copy is the Poster at 4x, every 4x4 block one Poster pixel", async () => {
  const root = makeTree();
  assert.equal(poster(root, fixtureScene).code, 0);
  const small = await rgba(join(root, sceneDir, "poster.png"));
  const og = await rgba(join(root, sceneDir, "poster-og.png"));
  for (let y = 0; y < 480; y++) for (let x = 0; x < 768; x++) {
    const o = (y * 768 + x) * 4;
    const s = ((y >> 2) * 192 + (x >> 2)) * 4;
    for (let c = 0; c < 4; c++) if (og.data[o + c] !== small.data[s + c]) assert.fail(`OG pixel ${x},${y} differs from Poster pixel ${x >> 2},${y >> 2}`);
  }
});

test("two poster runs write byte-identical files", () => {
  const root = makeTree();
  assert.equal(poster(root, fixtureScene).code, 0);
  const first = [readFileSync(join(root, sceneDir, "poster.png")), readFileSync(join(root, sceneDir, "poster-og.png"))];
  assert.equal(poster(root, join(root, fixtureScene)).code, 0);
  assert.deepEqual([readFileSync(join(root, sceneDir, "poster.png")), readFileSync(join(root, sceneDir, "poster-og.png"))], first);
});

test("poster fails with a JSON error when an Element PNG is missing", () => {
  const root = makeTree();
  rmSync(join(root, "library/elements/cat-tabby-asleep-01.strip.png"));
  const { code, stdout } = poster(root, fixtureScene);
  assert.equal(code, 1);
  const report = JSON.parse(stdout);
  assert.equal(report.ok, false);
  assert.match(report.error, /cat-tabby-asleep-01\.strip\.png/);
});

test("poster fails with a JSON error when the Scene plan does not parse", () => {
  const root = makeTree();
  const { code, stdout } = poster(root, "scenes/nope/scene.json");
  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout).ok, false);
});

test("adding all nine Primitives to the plan leaves the Poster and its Open Graph copy byte-identical", () => {
  const root = makeTree();
  const files = () => [readFileSync(join(root, sceneDir, "poster.png")), readFileSync(join(root, sceneDir, "poster-og.png"))];
  editJson(root, fixtureScene, (plan) => { plan.primitives = []; });
  assert.equal(poster(root, fixtureScene).code, 0);
  const without = files();
  editJson(root, fixtureScene, (plan) => { plan.primitives = readJson(join(fixtures, "primitives"), "scene.json").primitives; });
  assert.equal(readJson(root, fixtureScene).primitives.length, 9);
  assert.equal(poster(root, fixtureScene).code, 0);
  assert.deepEqual(files(), without);
});
