import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { orphans } from "../pipeline/lib/pixel-ops.ts";
import { editJson, fixturePalette, fixtureScene, makeTree, readJson, runScript } from "./helpers.ts";

const sceneDir = "scenes/fixture-rainy-desk-a1b2";

async function decoded(root: string, file: string) {
  const { data, info } = await sharp(join(root, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

test("project-features writes each side-wall and floor Feature at the box its corners project to", async () => {
  const root = makeTree();
  const { code, out, stderr } = runScript(root, "project-features", fixtureScene);
  assert.equal(code, 0, stderr);
  const got = Object.fromEntries(out.features.map((f: any) => [f.placement, [f.surface, f.file, f.box]]));
  // 32x36 at along 4, across 40 on the left wall: its near edge at x 13.0 stands 36 px tall, its far edge at x 44.1.
  assert.deepEqual(got.painting, ["left", `${sceneDir}/features/painting.png`, { x: 12, y: 53, w: 33, h: 42 }]);
  // 88x24 at along 100, across 4 on the floor: its near edge at y 234.8 runs 88 px wide.
  assert.deepEqual(got.rug, ["floor", `${sceneDir}/features/rug.png`, { x: 139, y: 218, w: 89, h: 17 }]);
  for (const f of out.features) {
    const png = await decoded(root, f.file);
    assert.deepEqual([png.width, png.height], [f.box.w, f.box.h]);
  }
});

test("a projected Feature keeps only Palette colours and binary alpha", async () => {
  const root = makeTree();
  assert.equal(runScript(root, "project-features", fixtureScene).code, 0);
  const colours = new Set<number>(readJson(root, `library/palettes/${fixturePalette}.json`).colours.map((hex: string) => parseInt(hex.slice(1), 16)));
  for (const name of ["painting", "rug"]) {
    const png = await decoded(root, `${sceneDir}/features/${name}.png`);
    let opaque = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      assert.ok(png.data[i + 3] === 0 || png.data[i + 3] === 255, `${name}: alpha ${png.data[i + 3]}`);
      if (png.data[i + 3] === 0) continue;
      opaque++;
      assert.ok(colours.has((png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]), `${name}: an opaque pixel is off the Palette`);
    }
    assert.ok(opaque > png.width * png.height * 0.6, `${name}: only ${opaque} opaque pixels`);
  }
});

test("project-features reports the Orphan pixels and checkerboards it measured in each projected file", async () => {
  const root = makeTree();
  const { out } = runScript(root, "project-features", fixtureScene);
  for (const f of out.features) {
    const measured = orphans(await decoded(root, f.file));
    assert.equal(f.orphans, measured.count);
    assert.equal(f.orphanShare, measured.share);
    assert.equal(typeof f.checkerboards, "number");
    assert.equal(typeof f.opaque, "number");
  }
});

test("a second run writes byte-identical files", () => {
  const root = makeTree();
  assert.equal(runScript(root, "project-features", fixtureScene).code, 0);
  const first = ["painting", "rug"].map((n) => readFileSync(join(root, sceneDir, `features/${n}.png`)));
  assert.equal(runScript(root, "project-features", fixtureScene).code, 0);
  const second = ["painting", "rug"].map((n) => readFileSync(join(root, sceneDir, `features/${n}.png`)));
  assert.deepEqual(second, first);
});

test("a painting on the left wall reads the right way round: its moon, right of centre square-on, stays right of centre", async () => {
  const root = makeTree();
  assert.equal(runScript(root, "project-features", fixtureScene, "painting").code, 0);
  const png = await decoded(root, `${sceneDir}/features/painting.png`);
  const moon = parseInt(readJson(root, `library/palettes/${fixturePalette}.json`).colours[12].slice(1), 16);
  const xs: number[] = [];
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] && ((png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]) === moon) xs.push((i / 4) % png.width);
  }
  assert.ok(xs.length > 0, "no moon pixels");
  assert.ok(Math.min(...xs) > png.width / 2, `moon at x ${Math.min(...xs)} of ${png.width}`);
});

test("naming Placements projects only those, and a back-wall Feature is skipped with no file", () => {
  const root = makeTree();
  rmSync(join(root, sceneDir, "features"), { recursive: true });
  editJson(root, fixtureScene, (plan) => {
    plan.layers[3].placements.push({ id: "clock", element: "painting-harbour-night-01", surface: "back", along: 4, across: 150 });
  });
  const { code, out, stderr } = runScript(root, "project-features", fixtureScene, "rug", "clock");
  assert.equal(code, 0, stderr);
  assert.deepEqual(out.features.map((f: any) => f.placement), ["rug"]);
  assert.deepEqual(out.skipped, [{ placement: "clock", reason: "a back-wall Feature draws 1:1 from its library PNG and needs no projected file" }]);
  assert.equal(existsSync(join(root, sceneDir, "features/painting.png")), false);
  assert.equal(existsSync(join(root, sceneDir, "features/clock.png")), false);
});

test("a Feature whose Element is not generated yet is skipped", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => {
    plan.status = "draft";
    plan.layers[3].placements[1].generate = { kind: "prop", brief: "striped rug, front view, flat on", realSize: { w: 1.5, h: 0.4 }, tags: ["rug"] };
  });
  const { code, out } = runScript(root, "project-features", fixtureScene);
  assert.equal(code, 0);
  assert.deepEqual(out.features.map((f: any) => f.placement), ["painting"]);
  assert.deepEqual(out.skipped, [{ placement: "rug", reason: "Element rug-wool-stripe-01 is not generated yet" }]);
});

for (const [what, args, message] of [
  ["no plan is given", [], /usage: project-features <scene\.json> \[placementId\.\.\.\]/],
  ["a named Placement is not a Feature", [fixtureScene, "cat"], /Placement cat is not a Feature on a Surface/],
  ["a named Placement does not exist", [fixtureScene, "sofa"], /no Placement sofa in Scene fixture-rainy-desk-a1b2/],
] as const) {
  test(`project-features exits non-zero when ${what}`, () => {
    const { code, out } = runScript(makeTree(), "project-features", ...args);
    assert.equal(code, 1);
    assert.match(out.error, message);
  });
}
