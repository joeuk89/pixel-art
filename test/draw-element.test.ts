import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { fixturePalette, fixtures, makeTree, readJson, runScript, validate, writeJson } from "./helpers.ts";

const PLAN = "scenes/rainy-desk-night-k7f2/scene.json";
const PALETTE = JSON.parse(readFileSync(join(fixtures, `library/palettes/${fixturePalette}.json`), "utf8")).colours as string[];

type Local = { id: string; element: string; generate: Record<string, unknown> };

const localProp = (id: string, generator: string, realSize: { w: number; h: number }, params: object): Local => ({
  id, element: `${id}-plain-local-01`,
  generate: { kind: "prop", brief: `a plain ${id}`, realSize, tags: [id], finish: "local", generator, params },
});

function tree(...placements: Local[]): string {
  const root = makeTree();
  const plan = JSON.parse(readFileSync(join(fixtures, "spec-example-scene.json"), "utf8"));
  plan.styleAnchor = null;
  plan.layers.push({ name: "furniture", kind: "placements", plane: "mid", placements: placements.map((p) => ({ ...p, x: 0, y: 0 })) });
  writeJson(root, PLAN, plan);
  return root;
}

const draw = (root: string, ...args: string[]) => runScript(root, "draw-element", PLAN, ...args);

async function pixelsOf(root: string, path: string) {
  const { data, info } = await sharp(join(root, path)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

for (const [placement, canvas] of [
  [localProp("rug", "rect", { w: 1, h: 0.5 }, { fill: 3 }), { width: 48, height: 24 }],
  [localProp("cabinet", "box", { w: 0.6, h: 0.8 }, { fill: 13, drawers: 2 }), { width: 32, height: 40 }],
  [localProp("bookcase", "shelf", { w: 1, h: 1.8 }, { frame: 14, books: [5, 9, 10] }), { width: 48, height: 88 }],
  [localProp("painting", "frame", { w: 1, h: 1 }, { colour: 11, mullionsAcross: 1, mullionsDown: 1 }), { width: 48, height: 48 }],
  [localProp("towers", "skyline", { w: 3.5, h: 2 }, { colour: 2, windows: [8, 9] }), { width: 168, height: 96 }],
] as const) {
  const generator = placement.generate.generator as string;
  test(`draw-element draws the ${generator} generator at its derived ${canvas.width}x${canvas.height} canvas and it passes the gate`, async () => {
    const root = tree(placement);
    const { code, out, stderr } = draw(root, placement.id);
    assert.equal(code, 0, stderr);
    assert.equal(out.ok, true);
    assert.equal(out.placement, placement.id);
    assert.equal(out.attempt, 1);
    assert.equal(out.service, "local");
    assert.equal(out.generator, generator);
    assert.equal(out.generations, 0);
    assert.deepEqual(out.canvas, canvas);
    assert.deepEqual(out.gate.failed, []);
    assert.deepEqual(out.gate.passed, ["dimensions", "alpha", "palette", "trimmed box"]);
    assert.equal(out.gate.ok, true);

    const png = await pixelsOf(root, out.scratch.png);
    assert.deepEqual([png.width, png.height], [canvas.width, canvas.height]);
    const onPalette = new Set(PALETTE);
    for (let i = 0; i < png.data.length; i += 4) {
      assert.ok(png.data[i + 3] === 0 || png.data[i + 3] === 255, "binary alpha");
      if (png.data[i + 3] === 255) {
        const hex = "#" + [png.data[i], png.data[i + 1], png.data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
        assert.ok(onPalette.has(hex), `${hex} is on the Palette`);
      }
    }
    const big = await sharp(join(root, out.scratch.upscale)).metadata();
    assert.deepEqual([big.width, big.height], [canvas.width * out.upscaleFactor, canvas.height * out.upscaleFactor]);
  });
}

const texture = (id: string, generator: string, params: object, size = { w: 64, h: 32 }): Local => ({
  id, element: `${id}-seamless-local-01`,
  generate: { kind: "texture", brief: `a seamless ${id}`, tags: [id], size, generator, params },
});

const placementIn = (plan: any, id: string) => plan.layers.flatMap((l: any) => l.placements ?? []).find((p: any) => p.id === id);

for (const [placement, transparent] of [
  [texture("sky", "sky-gradient", { colours: [0, 1, 2, 3] }), false],
  [texture("starfield", "stars", { sky: 1, stars: [7, 12], seed: 9 }), false],
  [texture("clouds", "cloud-band", { cloud: 3, seed: 4 }, { w: 96, h: 48 }), true],
  [texture("floor", "boards", { fill: 13, joints: 2 }), false],
  [texture("wall", "plaster", { fill: 13, density: 0.05 }), false],
] as const) {
  const generator = placement.generate.generator as string;
  test(`a ${generator} texture passes the wrap-seam check and --accept writes it seamless`, async () => {
    const root = tree(placement);
    const drawn = draw(root, placement.id);
    assert.equal(drawn.code, 0, drawn.stderr);
    assert.deepEqual(drawn.out.canvas, { width: (placement.generate.size as any).w, height: (placement.generate.size as any).h });
    assert.deepEqual(drawn.out.gate.passed, ["dimensions", "alpha", "palette", "wrap seam"]);
    assert.equal(drawn.out.gate.measurements.wrapSeamMismatch, 0);

    const accepted = draw(root, placement.id, "--accept", drawn.out.scratch.png);
    assert.equal(accepted.code, 0, accepted.stderr);
    const record = readJson(root, `library/elements/${placement.element}.json`);
    assert.equal(record.kind, "texture");
    assert.equal(record.seamless, true);
    assert.equal(record.transparent, transparent);
    assert.equal(placementIn(readJson(root, PLAN), placement.id).generate, undefined);
  });
}

test("--accept writes a record with service local, the generator and the full params, at zero cost", async () => {
  const root = tree(localProp("cabinet", "box", { w: 0.6, h: 0.8 }, { fill: 13, drawers: 2 }));
  const drawn = draw(root, "cabinet");
  assert.equal(drawn.code, 0, drawn.stderr);
  const accepted = draw(root, "cabinet", "--accept", drawn.out.scratch.png);
  assert.equal(accepted.code, 0, accepted.stderr);
  assert.equal(accepted.out.element, "cabinet-plain-local-01");

  const record = readJson(root, "library/elements/cabinet-plain-local-01.json");
  assert.equal(record.kind, "prop");
  assert.equal(record.service, "local");
  assert.equal(record.generator, "box");
  assert.deepEqual(record.params, { fill: 13, drawers: 2, topShare: 0.2 });
  assert.deepEqual([record.width, record.height], [32, 40]);
  assert.deepEqual(record.realSize, { w: 0.6, h: 0.8 });
  assert.equal(record.palette, fixturePalette);
  assert.deepEqual(record.cost, { pixellabGenerations: 0, meteredUsd: 0 });
  assert.deepEqual(readFileSync(join(root, "library/elements/cabinet-plain-local-01.png")), readFileSync(join(root, drawn.out.scratch.png)));

  const plan = readJson(root, PLAN);
  assert.equal(placementIn(plan, "cabinet").element, "cabinet-plain-local-01");
  assert.equal(placementIn(plan, "cabinet").generate, undefined);
  assert.equal(plan.cost.pixellabGenerations, 0);
  const check = validate(root);
  assert.deepEqual(check.report.errors, []);
});

test("a generator run twice with the same params draws byte-identical PNGs", () => {
  const root = tree(localProp("towers", "skyline", { w: 4, h: 2 }, { colour: 2, windows: [8, 9], seed: 31 }));
  const first = draw(root, "towers");
  const second = draw(root, "towers");
  assert.equal(second.out.attempt, 2);
  assert.deepEqual(readFileSync(join(root, second.out.scratch.png)), readFileSync(join(root, first.out.scratch.png)));
  const reseeded = draw(root, "towers", "--param", "seed=32");
  assert.notDeepEqual(readFileSync(join(root, reseeded.out.scratch.png)), readFileSync(join(root, first.out.scratch.png)));
});

test("--generator and --param override the plan's generator and params", () => {
  const root = tree(localProp("rug", "rect", { w: 1, h: 0.5 }, { fill: 3 }));
  const { code, out, stderr } = draw(root, "rug", "--generator", "box", "--param", "fill=13", "--param", "drawers=1");
  assert.equal(code, 0, stderr);
  assert.equal(out.generator, "box");
  assert.deepEqual(out.params, { fill: 13, drawers: 1, topShare: 0.2 });
});

test("a colour the Palette does not have fails the gate's Palette check and is drawn unsnapped", async () => {
  const root = tree(localProp("rug", "rect", { w: 1, h: 0.5 }, { fill: "#ff00ff", border: 3 }));
  const { code, out, stderr } = draw(root, "rug");
  assert.equal(code, 0, stderr);
  assert.equal(out.gate.ok, false);
  assert.ok(out.gate.failed.some((f: string) => /^palette: \d+ opaque pixels not in the Palette/.test(f)), JSON.stringify(out.gate.failed));
  const png = await pixelsOf(root, out.scratch.png);
  const centre = (12 * png.width + 24) * 4;
  assert.deepEqual([...png.data.subarray(centre, centre + 4)], [255, 0, 255, 255]);

  const accepted = draw(root, "rug", "--accept", out.scratch.png);
  assert.equal(accepted.code, 1);
  assert.match(accepted.out.error, /failed the Quality gate: palette/);
});

for (const [what, placement, args, message] of [
  ["a service-Finish prop", { id: "lamp", element: "lamp-brass-desk-01", generate: { kind: "prop", brief: "brass lamp", realSize: { w: 0.3, h: 0.5 }, tags: ["lamp"] } }, [], /service Finish; draw it with generate-element/],
  ["a generator the engine lacks", localProp("rug", "rect", { w: 1, h: 0.5 }, { fill: 3 }), ["--generator", "teapot"], /no generator teapot/],
  ["a texture generator for a prop", localProp("rug", "rect", { w: 1, h: 0.5 }, { fill: 3 }), ["--generator", "plaster"], /plaster draws a texture/],
  ["params the generator rejects", localProp("rug", "rect", { w: 1, h: 0.5 }, { fill: 3 }), ["--param", "fill=beige"], /params\.fill/],
  ["a colour index beyond the Palette", localProp("rug", "rect", { w: 1, h: 0.5 }, { fill: 40 }), [], /colour index 40 is not in Palette/],
] as const) {
  test(`draw-element refuses ${what} and writes no Attempt`, () => {
    const root = tree(placement as Local);
    const { code, out } = draw(root, placement.id, ...args);
    assert.equal(code, 1);
    assert.match(out.error, message);
  });
}
