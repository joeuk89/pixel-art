import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STAGE_F, SCENE_HEIGHT, SCENE_WIDTH } from "../schema/index.ts";
import { makeTree, runScript } from "./helpers.ts";

const centre = { x: SCENE_WIDTH / 2, y: SCENE_HEIGHT / 2 };
const derive = (...args: string[]) => runScript(makeTree(), "derive-stage", ...args);

// The penthouse as a 7.25 m wide, 2.8 m high, 6 m deep room seen from 1.5 m: its back wall fills the 384 px width.
test("the penthouse room at 1.0x gives a back wall the canvas width, its Scale and the default f", () => {
  const { code, out, stderr } = derive("--room", "7.25x2.8x6", "--eye", "1.5");
  assert.equal(code, 0, stderr);
  assert.deepEqual(out.stage, { back: { x: 0, y: 51, w: 384, h: 148 }, vanishingPoint: centre, f: DEFAULT_STAGE_F });
  assert.equal(out.scale, 52.97);
  assert.deepEqual(out.floorPolygon, [{ x: 0, y: 199 }, { x: 384, y: 199 }, { x: 384, y: 240 }, { x: 0, y: 240 }]);
  assert.equal(out.horizon, undefined);
});

test("the penthouse room at 1.25x scales the back wall, f and the Scale about the vanishing point", () => {
  const { code, out, stderr } = derive("--room", "7.25x2.8x6", "--eye", "1.5", "--zoom", "1.25");
  assert.equal(code, 0, stderr);
  assert.deepEqual(out.stage, { back: { x: -48, y: 34, w: 480, h: 185 }, vanishingPoint: centre, f: 150 });
  assert.equal(out.scale, 66.21);
  assert.deepEqual(out.floorPolygon, [{ x: 0, y: 219 }, { x: 384, y: 219 }, { x: 384, y: 240 }, { x: 0, y: 240 }]);
});

test("--f sets the viewing distance at 1.0x and still scales with the zoom", () => {
  const { code, out, stderr } = derive("--room", "7.25x2.8x6", "--eye", "1.5", "--zoom", "1.25", "--f", "100");
  assert.equal(code, 0, stderr);
  assert.equal(out.stage.f, 125);
});

test("outdoors the room's h is the horizon height, and the horizon sits at the top of the back rectangle", () => {
  const { code, out, stderr } = derive("--room", "40x3x60", "--eye", "1.6", "--outdoors");
  assert.equal(code, 0, stderr);
  assert.deepEqual(out.stage, { back: { x: 0, y: 107, w: 384, h: 28 }, vanishingPoint: centre, f: DEFAULT_STAGE_F });
  assert.equal(out.scale, 9.6);
  assert.equal(out.horizon, 107);
  assert.deepEqual(out.floorPolygon, [{ x: 0, y: 135 }, { x: 384, y: 135 }, { x: 384, y: 240 }, { x: 0, y: 240 }]);
});

test("derive-stage reports how deep the floor it shows runs, in metres", () => {
  const { out } = derive("--room", "7.25x2.8x6", "--eye", "1.5");
  assert.equal(out.floorDepthShown, 0.77);
});

for (const [what, args, message] of [
  ["--room is missing", ["--eye", "1.5"], /usage/],
  ["--room is not WxHxD", ["--room", "7x2.8", "--eye", "1.5"], /--room/],
  ["--eye is missing", ["--room", "7.25x2.8x6"], /usage/],
  ["the eye is above the ceiling indoors", ["--room", "7.25x2.8x6", "--eye", "3"], /eye height 3 m is not below the 2.8 m ceiling/],
  ["the floor line falls below the canvas", ["--room", "4x5x5", "--eye", "2.5"], /floor line .* below the canvas/],
  ["the zoom is not a positive number", ["--room", "7.25x2.8x6", "--eye", "1.5", "--zoom", "big"], /--zoom/],
] as const) {
  test(`derive-stage exits non-zero with one JSON object when ${what}`, () => {
    const { code, out, stderr } = derive(...args);
    assert.equal(code, 1);
    assert.equal(out.ok, false);
    assert.match(out.error, message);
    assert.match(stderr, message);
  });
}
