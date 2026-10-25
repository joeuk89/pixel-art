import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { editJson, fixturePalette, fixtureScene, makeTree, readJson, runScript } from "./helpers.ts";

const sceneDir = "scenes/fixture-rainy-desk-a1b2";
// Near the spec's illustrative Stage: the floor row at depth d sits at y = 118 + 86 * 150 / (150 - d).
const STAGE = { back: { x: 36, y: 18, w: 312, h: 186 }, vanishingPoint: { x: 190, y: 118 }, f: 150 };
const FLAT = { back: { colour: 2 }, floor: { colour: 11 }, ceiling: { colour: 1 }, left: { colour: 3 }, right: { colour: 14 } };

function sceneWithRoom(room: object, stage: object | undefined = STAGE): string {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => {
    plan.status = "draft";
    if (stage) plan.stage = stage;
    else delete plan.stage;
    plan.layers = plan.layers.filter((l: any) => l.kind !== "room");
    plan.layers.splice(3, 0, { name: "shell", kind: "room", plane: "mid", surfaces: FLAT, openings: [], placements: [], ...room });
  });
  return root;
}

async function shell(root: string) {
  const run = runScript(root, "room-shell", fixtureScene);
  assert.equal(run.code, 0, run.stderr + JSON.stringify(run.out));
  const { data, info } = await sharp(join(root, sceneDir, "room.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [384, 240]);
  return { out: run.out, at: (x: number, y: number) => [...data.subarray((y * 384 + x) * 4, (y * 384 + x) * 4 + 4)] };
}

const colours: string[] = readJson(makeTree(), `library/palettes/${fixturePalette}.json`).colours;
const opaque = (index: number) => {
  const n = parseInt(colours[index].slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255, 255];
};
const CLEAR = [0, 0, 0, 0];

test("room-shell paints each Surface its flat Palette colour into room.png beside the plan", async () => {
  const { out, at } = await shell(sceneWithRoom({}));
  assert.deepEqual(out, { ok: true, scene: "fixture-rainy-desk-a1b2", room: `${sceneDir}/room.png` });
  assert.deepEqual(at(100, 50), opaque(2), "back wall");
  assert.deepEqual(at(190, 230), opaque(11), "floor");
  assert.deepEqual(at(190, 5), opaque(1), "ceiling");
  assert.deepEqual(at(10, 110), opaque(3), "left wall");
  assert.deepEqual(at(375, 110), opaque(14), "right wall");
});

test("a Surface left out of the room Layer is not drawn", async () => {
  const { back, floor, left, right } = FLAT;
  const { at } = await shell(sceneWithRoom({ surfaces: { back, floor, left, right } }));
  assert.deepEqual(at(190, 5), CLEAR);
  assert.deepEqual(at(100, 50), opaque(2));
});

test("floor boards draw one-pixel rows at their projected depth in the floor colour's dark Ramp step", async () => {
  const { at } = await shell(sceneWithRoom({ surfaces: { ...FLAT, floor: { colour: 11, lines: { pattern: "boards", spacing: 12 } } } }));
  // Depth 0, 12 and 24 land on rows 204, 211.48 and 220.38; colour 11 steps dark to colour 0.
  for (const y of [204, 211, 220]) assert.deepEqual(at(190, y), opaque(0), `row ${y}`);
  for (const y of [207, 216]) assert.deepEqual(at(150, y), opaque(11), `between rows at ${y}`);
});

test("a line closer than 3 px to the last one drawn is dropped", async () => {
  const { at } = await shell(sceneWithRoom({ surfaces: { ...FLAT, floor: { colour: 11, lines: { pattern: "grid", spacing: 2 } } } }));
  // Depth 2 and 4 land on rows 205.16 and 206.36, within 3 px of row 204; depth 6 lands on 207.58, row 208.
  assert.deepEqual(at(190, 204), opaque(0));
  assert.deepEqual(at(190, 205), opaque(11), "the depth 2 row is dropped");
  assert.deepEqual(at(190, 206), opaque(11), "the depth 4 row is dropped");
  assert.deepEqual(at(190, 208), opaque(0));
});

test("wall skirting runs along the bottom of a wall, foreshortened with it", async () => {
  const { at } = await shell(sceneWithRoom({ surfaces: { ...FLAT, left: { colour: 3, skirting: { height: 6, colour: 0 } } } }));
  assert.deepEqual(at(10, 215), opaque(0));
  assert.deepEqual(at(10, 200), opaque(3));
});

test("an Opening is cut transparent, with its frame and mullion drawn in the frame colour", async () => {
  const window = { id: "window", surface: "back", along: 100, across: 40, w: 81, h: 60, frame: { width: 3, colour: 8, mullionsAcross: 1, mullionsDown: 0 } };
  const { at } = await shell(sceneWithRoom({ openings: [window] }));
  // The Opening spans x 136 to 216 and y 58 to 117; its one mullion stands at x 175 to 177.
  assert.deepEqual(at(150, 80), CLEAR, "left pane");
  assert.deepEqual(at(190, 80), CLEAR, "right pane");
  assert.deepEqual(at(137, 80), opaque(8), "left frame");
  assert.deepEqual(at(150, 59), opaque(8), "top frame");
  assert.deepEqual(at(150, 116), opaque(8), "bottom frame");
  assert.deepEqual(at(150, 115), opaque(9), "the frame's inner edge, in its dark Ramp step");
  assert.deepEqual(at(176, 80), opaque(8), "mullion");
  assert.deepEqual(at(130, 80), opaque(2), "wall beside the Opening");
});

test("a round Opening is cut as the circle inside its box, with a ring frame and crossed mullions", async () => {
  const window = { id: "oculus", surface: "back", shape: "round", along: 100, across: 40, w: 60, h: 60, frame: { width: 3, colour: 8, mullionsAcross: 1, mullionsDown: 1 } };
  const { at } = await shell(sceneWithRoom({ openings: [window] }));
  // The box spans x 136 to 195 and y 58 to 117, so the circle is centred on (166, 88) with radius 30.
  assert.deepEqual(at(152, 74), CLEAR, "upper-left pane");
  assert.deepEqual(at(180, 102), CLEAR, "lower-right pane");
  assert.deepEqual(at(137, 88), opaque(8), "ring at the left");
  assert.deepEqual(at(166, 59), opaque(8), "ring at the top");
  assert.deepEqual(at(165, 74), opaque(8), "upright mullion");
  assert.deepEqual(at(152, 88), opaque(8), "crossbar");
  assert.deepEqual(at(138, 60), opaque(2), "wall in the box's corner, outside the circle");
  assert.deepEqual(at(134, 88), opaque(2), "wall beside the Opening");
});

test("a frame's mullions can be thinner than its ring, which is shaded on its inner edge", async () => {
  const window = { id: "oculus", surface: "back", shape: "round", along: 100, across: 40, w: 60, h: 60, frame: { width: 5, mullionWidth: 3, colour: 8, mullionsAcross: 1, mullionsDown: 1 } };
  const { at } = await shell(sceneWithRoom({ openings: [window] }));
  // Centred on (166, 88) with radius 30: the ring runs 5 px in, the upright mullion stands at x 164 to 166.
  assert.deepEqual(at(137, 88), opaque(8), "outer ring");
  assert.deepEqual(at(140, 88), opaque(9), "the ring's inner edge, in the frame colour's dark Ramp step");
  assert.deepEqual(at(150, 74), CLEAR, "pane");
  assert.deepEqual(at(164, 74), opaque(8), "mullion");
  assert.deepEqual(at(163, 74), CLEAR, "pane beside the 3 px mullion");
});

test("two runs on the same plan write byte-identical room.png files", async () => {
  const lined = { ...FLAT, floor: { colour: 11, lines: { pattern: "boards", spacing: 12 } }, ceiling: { colour: 1, lines: { pattern: "coffers", spacing: 40 } }, right: { colour: 14, lines: { pattern: "grid", spacing: 16 }, skirting: { height: 4, colour: 0 } } };
  const root = sceneWithRoom({ surfaces: lined, openings: [{ id: "window", surface: "back", along: 24, across: 0, w: 264, h: 148, frame: { width: 3, colour: 1, mullionsAcross: 2, mullionsDown: 0 } }] });
  await shell(root);
  const first = readFileSync(join(root, sceneDir, "room.png"));
  await shell(root);
  assert.ok(first.equals(readFileSync(join(root, sceneDir, "room.png"))));
});

test("room-shell fails on a Scene without a room Layer", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers = plan.layers.filter((l: any) => l.kind !== "room"); });
  const run = runScript(root, "room-shell", fixtureScene);
  assert.equal(run.code, 1);
  assert.match(run.out.error, /no room Layer/);
});
