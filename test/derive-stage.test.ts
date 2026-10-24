import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STAGE_F, SCENE_HEIGHT, SCENE_WIDTH } from "../schema/index.ts";
import { makeTree, runScript } from "./helpers.ts";

const midX = SCENE_WIDTH / 2;
const floorBand = (y: number) => [{ x: 0, y }, { x: SCENE_WIDTH, y }, { x: SCENE_WIDTH, y: SCENE_HEIGHT }, { x: 0, y: SCENE_HEIGHT }];
const derive = (...args: string[]) => runScript(makeTree(), "derive-stage", ...args);

// The penthouse as a 7.25 m wide, 2.8 m high, 6 m deep room seen from 1.5 m: its back wall fills the 384 px width.
// A back wall too tall to centre puts its floor line a quarter of the canvas above the bottom and crops the ceiling.
test("the penthouse room at 1.0x gives a back wall the canvas width, its Scale and the default f", () => {
  const { code, out, stderr } = derive("--room", "7.25x2.8x6", "--eye", "1.5");
  assert.equal(code, 0, stderr);
  assert.deepEqual(out.stage, { back: { x: 0, y: 32, w: 384, h: 148 }, vanishingPoint: { x: midX, y: 101 }, f: DEFAULT_STAGE_F });
  assert.equal(out.scale, 52.97);
  assert.deepEqual(out.floorPolygon, floorBand(180));
  assert.equal(out.horizon, undefined);
});

test("the penthouse room at 1.25x scales the back wall, f and the Scale and keeps the floor band", () => {
  const { code, out, stderr } = derive("--room", "7.25x2.8x6", "--eye", "1.5", "--zoom", "1.25");
  assert.equal(code, 0, stderr);
  assert.deepEqual(out.stage, { back: { x: -48, y: -5, w: 480, h: 185 }, vanishingPoint: { x: midX, y: 81 }, f: 150 });
  assert.equal(out.scale, 66.21);
  assert.deepEqual(out.floorPolygon, floorBand(180));
});

for (const [room, eye, back, vpY] of [
  ["5x2.6x4", "1.6", { x: 0, y: -20, w: 384, h: 200 }, 57],
  ["3.5x2.5x4", "1.5", { x: 0, y: -94, w: 384, h: 274 }, 15],
] as const) {
  test(`a ${room} room seen from ${eye} m crops its ceiling and keeps a visible floor`, () => {
    const { code, out, stderr } = derive("--room", room, "--eye", eye);
    assert.equal(code, 0, stderr);
    assert.deepEqual(out.stage.back, back);
    assert.deepEqual(out.stage.vanishingPoint, { x: midX, y: vpY });
    assert.deepEqual(out.floorPolygon, floorBand(180));
    assert.ok(out.floorDepthShown > 0);
  });
}

test("--f sets the viewing distance at 1.0x and still scales with the zoom", () => {
  const { code, out, stderr } = derive("--room", "7.25x2.8x6", "--eye", "1.5", "--zoom", "1.25", "--f", "100");
  assert.equal(code, 0, stderr);
  assert.equal(out.stage.f, 125);
});

test("outdoors the room's h is the horizon height, the short back rectangle is centred and the horizon is its top", () => {
  const { code, out, stderr } = derive("--room", "40x3x60", "--eye", "1.6", "--outdoors");
  assert.equal(code, 0, stderr);
  assert.deepEqual(out.stage, { back: { x: 0, y: 105, w: 384, h: 29 }, vanishingPoint: { x: midX, y: 119 }, f: DEFAULT_STAGE_F });
  assert.equal(out.scale, 9.6);
  assert.equal(out.horizon, 105);
  assert.deepEqual(out.floorPolygon, floorBand(134));
});

test("derive-stage reports how deep the floor it shows runs, in metres", () => {
  const { out } = derive("--room", "7.25x2.8x6", "--eye", "1.5");
  assert.equal(out.floorDepthShown, 0.98);
});

for (const [what, args, message] of [
  ["--room is missing", ["--eye", "1.5"], /usage/],
  ["--room is not WxHxD", ["--room", "7x2.8", "--eye", "1.5"], /--room/],
  ["--eye is missing", ["--room", "7.25x2.8x6"], /usage/],
  ["the eye is above the ceiling indoors", ["--room", "7.25x2.8x6", "--eye", "3"], /eye height 3 m is not below the 2.8 m ceiling/],
  ["the vanishing point would sit above the canvas", ["--room", "4x5x5", "--eye", "2.5"], /vanishing point at y -60 .* above the canvas/],
  ["the eye is too low to show the floor", ["--room", "4x3x4", "--eye", "0.001"], /eye height 0.001 m puts the vanishing point on the floor line/],
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
