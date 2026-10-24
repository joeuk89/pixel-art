import { test } from "node:test";
import assert from "node:assert/strict";
import { floorPolygon, locate, onFloor, project, scaleAt, type Surface } from "../pipeline/lib/perspective.ts";

// The penthouse Stage of prototype/resolution at 384x240: its 192x120 geometry doubled at zoom 1.0.
const penthouse = { back: { x: 112, y: 24, w: 240, h: 148 }, vanishingPoint: { x: 236, y: 96 }, f: 240 };

const close = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-3, `${what}: ${actual} is not ${expected}`);

for (const [surface, px, py] of [
  ["back", 200, 100],
  ["floor", 236, 230],
  ["ceiling", 236, 5],
  ["left", 20, 100],
  ["right", 370, 100],
] as [Surface, number, number][]) {
  test(`locate finds the ${surface} at pixel ${px},${py} and project takes it back to the pixel centre`, () => {
    const found = locate(penthouse, px, py);
    assert.equal(found?.surface, surface);
    const { x, y } = project(penthouse, surface, found!.along, found!.across);
    close(x, px + 0.5, "x");
    close(y, py + 0.5, "y");
  });
}

test("locate measures floor depth from the back wall in back-wall pixels", () => {
  const found = locate(penthouse, 235, 239)!;
  assert.equal(found.surface, "floor");
  close(found.across, 112.8920, "depth");
  close(found.along, 123.7352, "along");
});

test("a back-wall point projects 1:1 from the back rectangle's corner", () => {
  assert.deepEqual(project(penthouse, "back", 10, 20), { x: 122, y: 44 });
});

test("the Scale at the back of the floor equals scale and grows toward the front edge", () => {
  assert.equal(scaleAt(penthouse, 52.9, 172), 52.9);
  close(scaleAt(penthouse, 52.9, 240), 100.2316, "front");
});

test("the penthouse floor polygon runs from the back wall to the canvas edges", () => {
  const polygon = floorPolygon(penthouse);
  const expected = [[112, 172], [352, 172], [384, 96 + (76 * 148) / 116], [384, 240], [1.0526, 240]];
  assert.equal(polygon.length, expected.length);
  polygon.forEach((p, i) => {
    close(p.x, expected[i][0], `vertex ${i} x`);
    close(p.y, expected[i][1], `vertex ${i} y`);
  });
});

test("a floor that leaves through both side edges of the canvas takes both bottom corners", () => {
  const stage = { back: { x: 158, y: 60, w: 64, h: 40 }, vanishingPoint: { x: 190, y: 80 }, f: 100 };
  const polygon = floorPolygon(stage).map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]);
  assert.deepEqual(polygon, [[158, 100], [222, 100], [384, 201.25], [384, 240], [0, 240], [0, 198.75]]);
});

for (const [x, y, inside] of [
  [236, 200, true],
  [384, 240, true],
  [200, 172, true],
  [200, 171, false],
  [10, 180, false],
  [236, 241, false],
] as const) {
  test(`a foot at ${x},${y} is ${inside ? "on" : "off"} the penthouse floor`, () => {
    assert.equal(onFloor(penthouse, { x, y }), inside);
  });
}
