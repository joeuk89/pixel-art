import { test } from "node:test";
import assert from "node:assert/strict";
import {
  binaryAlpha, checkerboards, crop, flipX, islands, opaqueBox, orphans, snapToPalette, softAlphaCount, transparentCount, trim, wrapSeamMismatch,
  type Pixels,
} from "../pipeline/lib/pixel-ops.ts";

const COLOURS: Record<string, [number, number, number]> = { a: [255, 0, 0], b: [0, 0, 255], c: [0, 255, 0] };

// One character per pixel: "." is transparent, a letter an opaque colour.
function grid(...rows: string[]): Pixels {
  const width = rows[0].length, height = rows.length;
  const data = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== ".") data.set([...COLOURS[ch], 255], (y * width + x) * 4);
  }));
  return { width, height, data };
}

function rows(p: Pixels): string[] {
  const names = Object.entries(COLOURS);
  return Array.from({ length: p.height }, (_, y) => Array.from({ length: p.width }, (_, x) => {
    const i = (y * p.width + x) * 4;
    if (p.data[i + 3] === 0) return ".";
    return names.find(([, [r, g, b]]) => r === p.data[i] && g === p.data[i + 1] && b === p.data[i + 2])?.[0] ?? "?";
  }).join(""));
}

test("opaqueBox and trim find the opaque pixels' bounding box and cut the canvas to it", () => {
  const p = grid(
    ".....",
    "..a..",
    ".ab..",
    ".....",
  );
  assert.deepEqual(opaqueBox(p), { x: 1, y: 1, width: 2, height: 2 });
  assert.deepEqual(rows(trim(p)), [".a", "ab"]);
  assert.deepEqual(opaqueBox(grid("..", "..")), { x: 0, y: 0, width: 0, height: 0 });
});

test("crop cuts a rectangle and flipX mirrors the columns", () => {
  const p = grid("abc", "cab");
  assert.deepEqual(rows(crop(p, 1, 0, 2, 2)), ["bc", "ab"]);
  assert.deepEqual(rows(flipX(p)), ["cba", "bac"]);
});

test("binaryAlpha rounds alpha to 0 below 128 and 255 from 128, and the alpha counts see it", () => {
  const p = grid("aaa");
  p.data[3] = 127;
  p.data[7] = 128;
  assert.equal(softAlphaCount(p), 2);
  const hard = binaryAlpha(p);
  assert.deepEqual([hard.data[3], hard.data[7], hard.data[11]], [0, 255, 255]);
  assert.equal(softAlphaCount(hard), 0);
  assert.equal(transparentCount(hard), 1);
  assert.equal(p.data[3], 127, "the input is left alone");
});

test("snapToPalette moves each off-Palette opaque colour to its nearest Palette colour in Oklab", () => {
  const p = grid("ab.");
  p.data.set([250, 10, 10], 0);
  p.data.set([20, 20, 60], 4);
  p.data.set([1, 2, 3], 8);
  const snapped = snapToPalette(p, ["#ff0000", "#000000", "#ffffff"]);
  assert.deepEqual([...snapped.frame.data.slice(0, 8)], [255, 0, 0, 255, 0, 0, 0, 255]);
  assert.deepEqual([...snapped.frame.data.slice(8, 11)], [1, 2, 3], "a transparent pixel keeps its colour");
  assert.equal(snapped.opaque, 2);
  assert.equal(snapped.offPalette, 2);
});

test("an Orphan pixel is an opaque pixel whose four neighbours all differ from it; the share is of opaque pixels", () => {
  const p = grid(
    "aaaa",
    "abaa",
    "aaab",
    "c..b",
  );
  assert.deepEqual(orphans(p), { count: 2, share: 2 / 14 });
  assert.deepEqual(orphans(grid("aa", "aa")), { count: 0, share: 0 });
  assert.deepEqual(orphans(grid("..")), { count: 0, share: 0 });
});

test("a 2x2 checkerboard is two opaque colours on the diagonals, counted per window", () => {
  assert.equal(checkerboards(grid("ab", "ba")), 1);
  assert.equal(checkerboards(grid("aba", "bab")), 2);
  assert.equal(checkerboards(grid("ab", "ab")), 0);
  assert.equal(checkerboards(grid("a.", ".a")), 0);
  assert.equal(checkerboards(grid("aa", "aa")), 0);
});

test("the wrap seam counts rows whose last column differs from the first", () => {
  assert.equal(wrapSeamMismatch(grid(
    "abca",
    "bcab",
    "c..c",
  )), 0);
  assert.equal(wrapSeamMismatch(grid(
    "abcb",
    "bcab",
    "a..b",
  )), 2);
  assert.equal(wrapSeamMismatch(grid("a.", ".a")), 2, "transparent against opaque is a mismatch");
});

test("islands counts opaque regions joined edge to edge, not at corners", () => {
  assert.equal(islands(grid("a.", ".b")), 2);
  assert.equal(islands(grid("ab", ".b")), 1);
  assert.equal(islands(grid("..")), 0);
});
