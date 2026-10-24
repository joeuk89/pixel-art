import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { makeTree, readJson, repo, writeJson } from "./helpers.ts";
import { runScript, startFixtureServer, type FixtureServer } from "./fixture-server.ts";
import { decodePng, encodePng, OFF_PALETTE_ACTION, pixellabState, type Rgba } from "./fixtures/services/pixellab.ts";

const script = join(repo, "pipeline/generate-strip.ts");
const ELEMENT = "cat-tabby-twitching-01";
const ELEMENTS = "library/elements";

let server: FixtureServer;
before(async () => { server = await startFixtureServer(); });
after(() => server.close());
beforeEach(() => pixellabState.reset());

function tree(): string {
  const root = makeTree();
  const record = readJson(root, `${ELEMENTS}/cat-tabby-asleep-01.json`);
  delete record.animation;
  writeJson(root, `${ELEMENTS}/${ELEMENT}.json`, { ...record, id: ELEMENT });
  copyFileSync(join(root, `${ELEMENTS}/cat-tabby-asleep-01.png`), join(root, `${ELEMENTS}/${ELEMENT}.png`));
  return root;
}

const run = (root: string, ...args: string[]) => runScript(script, [ELEMENT, ...args], { cwd: root, env: server.env });

async function decode(path: string): Promise<Rgba> {
  return decodePng(readFileSync(path));
}

function frameOf(strip: Rgba, k: number, width: number): Uint8Array {
  const out = new Uint8Array(width * strip.height * 4);
  for (let y = 0; y < strip.height; y++) {
    out.set(strip.data.subarray((y * strip.width + k * width) * 4, (y * strip.width + (k + 1) * width) * 4), y * width * 4);
  }
  return out;
}

test("a PixelLab run yields exactly the asked frames with the still as frame 0 and no duplicated still", async () => {
  const root = tree();
  const result = await run(root);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.service, "pixellab");
  assert.equal(result.json.frames, 4);
  assert.equal(pixellabState.animateRequests[0].frame_count, 3);

  const strip = await decode(join(root, result.json.scratch.strip));
  assert.deepEqual([strip.width, strip.height], [96, 16]);
  const still = await decode(join(root, `${ELEMENTS}/${ELEMENT}.png`));
  assert.deepEqual(frameOf(strip, 0, 24), still.data);
  for (let k = 1; k < 4; k++) assert.notDeepEqual(frameOf(strip, k, 24), still.data, `frame ${k} repeats the still`);
  assert.equal(result.json.gate.ok, true, JSON.stringify(result.json.gate));
  assert.deepEqual(result.json.gate.passed, ["dimensions", "alpha", "palette", "motion", "drift", "seam"]);
});

const COSY = JSON.parse(readFileSync(join(repo, "library/palettes/cosy-night.json"), "utf8")).colours as string[];
const MOVED: [number, number, number] = [0xf7, 0xd3, 0x5c];

async function stillOf(root: string): Promise<{ still: Rgba; opaque: number[] }> {
  const still = await decode(join(root, `${ELEMENTS}/${ELEMENT}.png`));
  const opaque: number[] = [];
  for (let p = 0; p < still.width * still.height; p++) if (still.data[p * 4 + 3] !== 0) opaque.push(p);
  assert.equal(opaque.length, 200, "the tests below count shares against the fixture cat's 200 opaque pixels");
  for (const p of opaque) assert.notDeepEqual([...still.data.subarray(p * 4, p * 4 + 3)], MOVED);
  return { still, opaque };
}

function recolour(still: Rgba, pixels: number[]): Rgba {
  const data = new Uint8Array(still.data);
  for (const p of pixels) data.set(MOVED, p * 4);
  return { ...still, data };
}

// The service's own frame 0 is replaced by the still, so only frames 1 onwards are queued.
async function gateOf(root: string, frames: Rgba[], ...args: string[]) {
  const action = `hand-made ${pixellabState.animations.size}`;
  const pngs = frames.map((f) => encodePng(f.width, f.height, f.data));
  pixellabState.animations.set(action, [pngs[0], ...pngs]);
  const result = await run(root, "--motion", action, ...args);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return result.json.gate;
}

const failedNames = (gate: any) => gate.failed.map((f: string) => f.split(":")[0]);

test("a strip with too few frames or a frame of the wrong size fails dimensions", async () => {
  const root = tree();
  const { still, opaque } = await stillOf(root);
  const few = await gateOf(root, [recolour(still, opaque.slice(0, 6)), recolour(still, opaque.slice(6, 12))]);
  assert.deepEqual(failedNames(few), ["dimensions"]);
  assert.match(few.failed[0], /3 frames making 72x16, expected 4 frames making 96x16/);

  const tall: Rgba = { width: 24, height: 20, data: new Uint8Array(24 * 20 * 4) };
  tall.data.set(still.data);
  const wrongSize = await gateOf(root, [recolour(still, opaque.slice(0, 6)), tall, recolour(still, opaque.slice(12, 18))]);
  assert.ok(failedNames(wrongSize).includes("dimensions"));
});

test("a frame with soft alpha fails alpha and names the frame", async () => {
  const root = tree();
  const { still, opaque } = await stillOf(root);
  const soft = recolour(still, opaque.slice(6, 12));
  soft.data[opaque[100] * 4 + 3] = 128;
  const gate = await gateOf(root, [recolour(still, opaque.slice(0, 6)), soft, recolour(still, opaque.slice(12, 18))]);
  assert.deepEqual(failedNames(gate), ["alpha"]);
  assert.match(gate.failed[0], /frame 2/);
});

test("every step must move at least 1% of opaque pixels", async () => {
  const root = tree();
  const { still, opaque } = await stillOf(root);
  const atOnePercent = await gateOf(root, [recolour(still, opaque.slice(0, 2)), recolour(still, opaque.slice(2, 4)), recolour(still, opaque.slice(4, 6))]);
  assert.deepEqual(atOnePercent.failed, []);
  assert.equal(atOnePercent.measurements.steps[0], 0.01);

  const under = await gateOf(root, [recolour(still, opaque.slice(0, 1)), recolour(still, opaque.slice(2, 4)), recolour(still, opaque.slice(4, 6))]);
  assert.deepEqual(failedNames(under), ["motion"]);
  assert.match(under.failed[0], /step 0 to 1 moves 0.5%/);

  const frozen = await gateOf(root, [recolour(still, opaque.slice(0, 6)), recolour(still, opaque.slice(0, 6)), recolour(still, opaque.slice(6, 12))]);
  assert.deepEqual(failedNames(frozen), ["motion"]);
});

test("the last frame may drift from frame 0 by at most 10%", async () => {
  const root = tree();
  const { still, opaque } = await stillOf(root);
  const atTen = await gateOf(root, [recolour(still, opaque.slice(0, 20)), recolour(still, opaque.slice(20, 40)), recolour(still, opaque.slice(40, 60))]);
  assert.deepEqual(atTen.failed, []);
  assert.equal(atTen.measurements.drift, 0.1);

  const over = await gateOf(root, [recolour(still, opaque.slice(0, 20)), recolour(still, opaque.slice(20, 40)), recolour(still, opaque.slice(40, 61))]);
  assert.deepEqual(failedNames(over), ["drift"]);
  assert.equal(over.measurements.drift, 0.105);
});

test("the seam from the last frame back to frame 0 may be at most 1.5x the mean step", async () => {
  const root = tree();
  const { still, opaque } = await stillOf(root);
  const growing = await gateOf(root, [recolour(still, opaque.slice(0, 2)), recolour(still, opaque.slice(0, 4)), recolour(still, opaque.slice(0, 8))]);
  assert.deepEqual(failedNames(growing), ["seam"]);
  assert.deepEqual(growing.measurements.steps, [0.01, 0.01, 0.02]);
  assert.equal(growing.measurements.seam, 0.04);

  const atLimit = await gateOf(root, [recolour(still, opaque.slice(0, 4)), recolour(still, opaque.slice(0, 2)), recolour(still, [...opaque.slice(0, 2), ...opaque.slice(4, 6)])]);
  assert.deepEqual(atLimit.measurements.steps, [0.02, 0.01, 0.01]);
  assert.equal(atLimit.measurements.seam, 0.02);
  assert.deepEqual(atLimit.failed, [], "a 2% seam is exactly 1.5x the 1.33% mean step");
});

test("the off-palette strip passes once snapped and records the pre-snap share as a warning", async () => {
  const root = tree();
  const result = await run(root, "--motion", OFF_PALETTE_ACTION);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const { gate } = result.json;
  assert.deepEqual(gate.failed, []);
  assert.equal(gate.measurements.offPaletteBefore, 0.75);
  assert.deepEqual(gate.warnings, ["75% of opaque pixels were off the Palette before snapping"]);

  const strip = await decode(join(root, result.json.scratch.strip));
  const allowed = new Set(COSY.map((h) => parseInt(h.slice(1), 16)));
  for (let i = 0; i < strip.data.length; i += 4) {
    if (strip.data[i + 3] !== 0) assert.ok(allowed.has((strip.data[i] << 16) | (strip.data[i + 1] << 8) | strip.data[i + 2]), "a snapped pixel is off the Palette");
  }
});
