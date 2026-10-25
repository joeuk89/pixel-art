import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { scenePlanSchema } from "../schema/index.ts";
import { createCompositor, type ElementPixels } from "../viewer/compositor.ts";
import { editJson, fixtureScene, fixtures, makeTree, readJson, repo, writeJson } from "./helpers.ts";

const sceneDir = "scenes/fixture-rainy-desk-a1b2";

function poster(root: string, ...args: string[]) {
  const run = spawnSync(process.execPath, [join(repo, "pipeline/poster.ts"), ...args], { cwd: root, encoding: "utf8" });
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
}

async function rgba(path: string) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

async function fixtureFrameZero(root: string, variant = 0): Promise<Uint8ClampedArray> {
  const plan = scenePlanSchema.parse(readJson(root, fixtureScene));
  const palette = readJson(root, `library/palettes/${plan.palette}.json`);
  const elements = new Map<string, ElementPixels>();
  for (const id of ["sky-stars-night-01", "skyline-night-warm-windows-01", "window-wood-transparent-panes-01", "cat-tabby-asleep-01", "painting-harbour-night-01", "rug-wool-stripe-01"]) {
    const record = readJson(root, `library/elements/${id}.json`);
    const still = await rgba(join(root, `library/elements/${id}.png`));
    const strip = record.animation && {
      image: await rgba(join(root, `library/elements/${id}.strip.png`)),
      frames: record.animation.frames,
      fps: record.animation.fps,
      order: record.animation.order,
    };
    const mask = record.emissiveMask && await rgba(join(root, `library/elements/${id}.emissive.png`));
    elements.set(id, { still, ...(strip && { strip }), ...(record.emissive && { emissive: record.emissive }), ...(mask && { mask }) });
  }
  const room = await rgba(join(root, sceneDir, "room.png"));
  const features = new Map([["painting", await rgba(join(root, sceneDir, "features/painting.png"))], ["rug", await rgba(join(root, sceneDir, "features/rug.png"))]]);
  return createCompositor({ plan, elements, palette, variant: plan.variants[variant], room, features }).render(0);
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
  assert.deepEqual([small.format, small.width, small.height], ["png", 384, 240]);
  assert.deepEqual([og.format, og.width, og.height], ["png", 768, 480]);
});

test("the 384x240 Poster equals lit frame 0 of the default Variant with Primitives off", async () => {
  const root = makeTree();
  assert.equal(poster(root, fixtureScene).code, 0);
  const written = Buffer.from((await rgba(join(root, sceneDir, "poster.png"))).data);
  assert.deepEqual(written, Buffer.from(await fixtureFrameZero(root, 0)));
  assert.notDeepEqual(written, Buffer.from(await fixtureFrameZero(root, 1)), "the second Variant lights the Scene differently");
});

test("the Poster keeps the skyline's emissive windows inside the mask and darkens those outside it", async () => {
  const root = makeTree();
  assert.equal(poster(root, fixtureScene).code, 0);
  const { data } = await rgba(join(root, sceneDir, "poster.png"));
  const mask = await rgba(join(root, "library/elements/skyline-night-warm-windows-01.emissive.png"));
  const windows = await rgba(join(root, "library/elements/skyline-night-warm-windows-01.png"));
  const yellow = [0xf7, 0xd3, 0x5c];
  let kept = 0;
  let darkened = 0;
  for (let y = 0; y < windows.height; y++) for (let x = 0; x < windows.width; x++) {
    const k = (y * windows.width + x) * 4;
    if (windows.data[k] !== yellow[0] || windows.data[k + 1] !== yellow[1] || windows.data[k + 2] !== yellow[2]) continue;
    const p = ((40 + y) * 384 + 64 + x) * 4;
    const same = data[p] === yellow[0] && data[p + 1] === yellow[1] && data[p + 2] === yellow[2];
    if (mask.data[k] === 255) assert.ok(same, `masked window pixel ${x},${y} is not kept`), kept++;
    else if (!same) darkened++;
  }
  assert.ok(kept > 0, "no window pixel sits inside the mask");
  assert.ok(darkened > 0, "every window pixel outside the mask stayed yellow");
});

test("a default Variant with a companion Palette renders a Poster in the companion's colours", async () => {
  const root = makeTree();
  writeJson(root, "library/palettes/fixture-dusk-v2.json", {
    ...readJson(root, "library/palettes/fixture-night-v2.json"),
    name: "fixture-dusk-v2",
    colours: readJson(root, "library/palettes/fixture-night-v2.json").colours.map((_: string, i: number) => `#${(i * 8).toString(16).padStart(2, "0")}0040`),
  });
  editJson(root, fixtureScene, (plan) => { plan.variants[0].companionPalette = "fixture-dusk-v2"; });
  const { code, stderr } = poster(root, fixtureScene);
  assert.equal(code, 0, stderr);
  const { data } = await rgba(join(root, sceneDir, "poster.png"));
  const lamp = { x: 168 + 124, y: 28 + 160, radius: 24 };
  let halo = 0;
  for (let i = 0; i < data.length; i += 4) {
    const x = (i / 4) % 384;
    const y = Math.floor(i / 4 / 384);
    if (data[i + 1] !== 0) assert.fail(`pixel ${x},${y} has green, which no dusk colour has`);
    if (Math.hypot(x - lamp.x, y - lamp.y) < lamp.radius) {
      if (data[i + 2] !== 0x40) halo++;
    } else if (data[i + 2] !== 0x40) assert.fail(`pixel ${x},${y} is not a dusk colour`);
  }
  assert.ok(halo > 0, "the lamp's Halo is not drawn in the companion's colour");
});

test("the Open Graph copy is the Poster at 2x, every 2x2 block one Poster pixel", async () => {
  const root = makeTree();
  assert.equal(poster(root, fixtureScene).code, 0);
  const small = await rgba(join(root, sceneDir, "poster.png"));
  const og = await rgba(join(root, sceneDir, "poster-og.png"));
  assert.deepEqual([og.width, og.height], [768, 480]);
  for (let y = 0; y < 480; y++) for (let x = 0; x < 768; x++) {
    const o = (y * 768 + x) * 4;
    const s = ((y >> 1) * 384 + (x >> 1)) * 4;
    for (let c = 0; c < 4; c++) if (og.data[o + c] !== small.data[s + c]) assert.fail(`OG pixel ${x},${y} differs from Poster pixel ${x >> 1},${y >> 1}`);
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
