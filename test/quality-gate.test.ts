import { test } from "node:test";
import assert from "node:assert/strict";
import { gateStill } from "../pipeline/lib/quality-gate.ts";

const PALETTE = ["#000000", "#ffffff"];

// A 4x2 texture: black and white columns, so the wrap seam compares column 3 against column 0.
function texture(lastColumn: "black" | "white") {
  const width = 4, height = 2;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const white = x === width - 1 ? lastColumn === "white" : x % 2 === 1;
      data.set(white ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const canvas = { width: 4, height: 2 };

test("a texture whose last column differs from its first fails the wrap seam", () => {
  const gate = gateStill(texture("white"), { kind: "texture", canvas, palette: PALETTE });
  assert.equal(gate.ok, false);
  assert.deepEqual(gate.failed, ["wrap seam: 2 of 2 rows differ between the last column and the first"]);
  assert.equal(gate.measurements.wrapSeamMismatch, 2);
});

test("a texture that wraps with zero mismatch passes the wrap seam", () => {
  const gate = gateStill(texture("black"), { kind: "texture", canvas, palette: PALETTE });
  assert.equal(gate.ok, true);
  assert.deepEqual(gate.passed, ["dimensions", "alpha", "palette", "wrap seam"]);
});

test("a Backdrop is checked for the wrap seam only before it is marked seamless", () => {
  const plain = gateStill(texture("white"), { kind: "backdrop", canvas, palette: PALETTE });
  assert.equal(plain.ok, true);
  assert.deepEqual(plain.passed, ["dimensions", "alpha", "palette", "opaque"]);
  const seamless = gateStill(texture("white"), { kind: "backdrop", seamless: true, canvas, palette: PALETTE });
  assert.deepEqual(seamless.failed, ["wrap seam: 2 of 2 rows differ between the last column and the first"]);
});
