import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { createCompositor } from "../viewer/compositor.ts";
import { loadElementPixels, loadPalette } from "../pipeline/lib/element-pixels.ts";
import { scenePlanSchema } from "../schema/index.ts";
import { editJson, fixtureScene, makeTree, readJson, repo, validate, writeJson } from "./helpers.ts";
import { runScript, startFixtureServer, type FixtureServer } from "./fixture-server.ts";
import { INFERENCE_FAILED, retroDiffusionState } from "./fixtures/services/retro-diffusion.ts";
import { decodePng, encodePng, OFF_PALETTE_ACTION, pixellabState, type Rgba } from "./fixtures/services/pixellab.ts";

const script = join(repo, "pipeline/generate-strip.ts");
const ELEMENT = "cat-tabby-twitching-01";
const ELEMENTS = "library/elements";

let server: FixtureServer;
before(async () => { server = await startFixtureServer(); });
after(() => server.close());
beforeEach(() => { pixellabState.reset(); retroDiffusionState.reset(); });

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
  assert.equal(result.json.frames, 5);
  assert.equal(pixellabState.animateRequests[0].frame_count, 4);

  const strip = await decode(join(root, result.json.scratch.strip));
  assert.deepEqual([strip.width, strip.height], [120, 16]);
  const still = await decode(join(root, `${ELEMENTS}/${ELEMENT}.png`));
  assert.deepEqual(frameOf(strip, 0, 24), still.data);
  for (let k = 1; k < 5; k++) assert.notDeepEqual(frameOf(strip, k, 24), still.data, `frame ${k} repeats the still`);
  assert.equal(result.json.gate.ok, true, JSON.stringify(result.json.gate));
  assert.deepEqual(result.json.gate.passed, ["dimensions", "alpha", "palette", "motion", "drift", "seam"]);
});

test("PixelLab --frames sends the even frame_count animate v3 accepts", async () => {
  const root = tree();
  const result = await run(root, "--frames", "7");
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(pixellabState.animateRequests[0].frame_count, 6);
  const strip = await decode(join(root, result.json.scratch.strip));
  assert.deepEqual([strip.width, strip.height], [168, 16]);
});

test("PixelLab --frames outside the odd numbers 5 to 15 is refused before any call", async () => {
  const root = tree();
  for (const frames of ["4", "6", "3", "17", "2"]) {
    const result = await run(root, "--frames", frames);
    assert.equal(result.code, 1, frames);
    assert.match(result.json.error, /--frames for pixellab must be an odd number from 5 to 15/);
  }
  assert.equal(pixellabState.animateRequests.length, 0);
});

function planWithStrip(strip: Record<string, unknown>): unknown {
  const plan = JSON.parse(readFileSync(join(repo, "test/fixtures/spec-example-scene.json"), "utf8"));
  plan.layers[2].placements[1].generate.strip = strip;
  return plan;
}

const stripOf = (plan: any) => plan.layers[2].placements[1].generate.strip;

test("a planned strip with no frames defaults per service to a count generate-strip accepts", async () => {
  const pixellab = stripOf(scenePlanSchema.parse(planWithStrip({ service: "pixellab" })));
  assert.deepEqual(pixellab, { service: "pixellab", frames: 5 });
  assert.deepEqual(stripOf(scenePlanSchema.parse(planWithStrip({}))), { service: "pixellab", frames: 5 });
  assert.deepEqual(stripOf(scenePlanSchema.parse(planWithStrip({ service: "retro-diffusion" }))), { service: "retro-diffusion", frames: 8 });

  const result = await run(tree(), "--service", pixellab.service, "--frames", String(pixellab.frames));
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.frames, 5);
});

test("a planned PixelLab strip outside the odd numbers 5 to 15 fails validate", () => {
  for (const frames of [4, 6, 3, 17]) {
    const root = makeTree();
    writeJson(root, "scenes/rainy-desk-night-k7f2/scene.json", planWithStrip({ service: "pixellab", frames }));
    const check = validate(root);
    assert.equal(check.code, 1, String(frames));
    assert.ok(
      check.report.errors.some((e: any) => e.path === "layers[2].placements[1].generate.strip.frames" && /odd number from 5 to 15/.test(e.message)),
      JSON.stringify(check.report.errors),
    );
  }
  const root = makeTree();
  writeJson(root, "scenes/rainy-desk-night-k7f2/scene.json", planWithStrip({ service: "retro-diffusion", frames: 4 }));
  assert.equal(validate(root).code, 0);
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
  assert.match(few.failed[0], /3 frames making 72x16, expected 5 frames making 120x16/);

  const tall: Rgba = { width: 24, height: 20, data: new Uint8Array(24 * 20 * 4) };
  tall.data.set(still.data);
  const wrongSize = await gateOf(root, [recolour(still, opaque.slice(0, 6)), tall, recolour(still, opaque.slice(12, 18)), recolour(still, opaque.slice(18, 24))]);
  assert.ok(failedNames(wrongSize).includes("dimensions"));
});

test("a frame with soft alpha fails alpha and names the frame", async () => {
  const root = tree();
  const { still, opaque } = await stillOf(root);
  const soft = recolour(still, opaque.slice(6, 12));
  soft.data[opaque[100] * 4 + 3] = 128;
  const gate = await gateOf(root, [recolour(still, opaque.slice(0, 6)), soft, recolour(still, opaque.slice(12, 18)), recolour(still, opaque.slice(18, 24))]);
  assert.deepEqual(failedNames(gate), ["alpha"]);
  assert.match(gate.failed[0], /frame 2/);
});

test("every step must move at least 1% of opaque pixels", async () => {
  const root = tree();
  const { still, opaque } = await stillOf(root);
  const atOnePercent = await gateOf(root, [recolour(still, opaque.slice(0, 2)), recolour(still, opaque.slice(2, 4)), recolour(still, opaque.slice(4, 6)), recolour(still, opaque.slice(6, 8))]);
  assert.deepEqual(atOnePercent.failed, []);
  assert.equal(atOnePercent.measurements.steps[0], 0.01);

  const under = await gateOf(root, [recolour(still, opaque.slice(0, 1)), recolour(still, opaque.slice(2, 4)), recolour(still, opaque.slice(4, 6)), recolour(still, opaque.slice(6, 8))]);
  assert.deepEqual(failedNames(under), ["motion"]);
  assert.match(under.failed[0], /step 0 to 1 moves 0.5%/);

  const frozen = await gateOf(root, [recolour(still, opaque.slice(0, 6)), recolour(still, opaque.slice(0, 6)), recolour(still, opaque.slice(6, 12)), recolour(still, opaque.slice(12, 18))]);
  assert.deepEqual(failedNames(frozen), ["motion"]);
});

test("the last frame may drift from frame 0 by at most 10%", async () => {
  const root = tree();
  const { still, opaque } = await stillOf(root);
  const atTen = await gateOf(root, [recolour(still, opaque.slice(0, 20)), recolour(still, opaque.slice(20, 40)), recolour(still, opaque.slice(40, 60)), recolour(still, opaque.slice(60, 80))]);
  assert.deepEqual(atTen.failed, []);
  assert.equal(atTen.measurements.drift, 0.1);

  const over = await gateOf(root, [recolour(still, opaque.slice(0, 20)), recolour(still, opaque.slice(20, 40)), recolour(still, opaque.slice(40, 60)), recolour(still, opaque.slice(60, 81))]);
  assert.deepEqual(failedNames(over), ["drift"]);
  assert.equal(over.measurements.drift, 0.105);
});

test("the seam from the last frame back to frame 0 may be at most 1.5x the mean step", async () => {
  const root = tree();
  const { still, opaque } = await stillOf(root);
  const growing = await gateOf(root, [recolour(still, opaque.slice(0, 2)), recolour(still, opaque.slice(0, 4)), recolour(still, opaque.slice(0, 8)), recolour(still, opaque.slice(0, 16))]);
  assert.deepEqual(failedNames(growing), ["seam"]);
  assert.deepEqual(growing.measurements.steps, [0.01, 0.01, 0.02, 0.04]);
  assert.equal(growing.measurements.seam, 0.08);

  const last = [...opaque.slice(4, 7), ...opaque.slice(8, 11)];
  const atLimit = await gateOf(root, [recolour(still, opaque.slice(0, 4)), recolour(still, opaque.slice(2, 6)), recolour(still, opaque.slice(4, 8)), recolour(still, last)]);
  assert.deepEqual(atLimit.measurements.steps, [0.02, 0.02, 0.02, 0.02]);
  assert.equal(atLimit.measurements.seam, 0.03);
  assert.deepEqual(atLimit.failed, [], "a 3% seam is exactly 1.5x the 2% mean step");
});

test("the off-palette strip passes once snapped and records the pre-snap share as a warning", async () => {
  const root = tree();
  const result = await run(root, "--motion", OFF_PALETTE_ACTION);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const { gate } = result.json;
  assert.deepEqual(gate.failed, []);
  assert.equal(gate.measurements.offPaletteBefore, 0.8);
  assert.deepEqual(gate.warnings, ["80% of opaque pixels were off the Palette before snapping"]);

  const strip = await decode(join(root, result.json.scratch.strip));
  const allowed = new Set(COSY.map((h) => parseInt(h.slice(1), 16)));
  for (let i = 0; i < strip.data.length; i += 4) {
    if (strip.data[i + 3] !== 0) assert.ok(allowed.has((strip.data[i] << 16) | (strip.data[i + 1] << 8) | strip.data[i + 2]), "a snapped pixel is off the Palette");
  }
});

test("a Retro Diffusion run makes 8 frames from the still with frame 0 the still and records the metered cost", async () => {
  const root = tree();
  const result = await run(root, "--service", "retro-diffusion");
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.frames, 8);
  assert.equal(retroDiffusionState.submits[0].body.frames_duration, 8);
  assert.equal(retroDiffusionState.submits[0].body.width, 24);
  assert.equal(retroDiffusionState.submits[0].body.height, 16);
  assert.deepEqual(result.json.cost, { pixellabGenerations: 0, meteredUsd: 0.25 });
  const strip = await decode(join(root, result.json.scratch.strip));
  assert.deepEqual([strip.width, strip.height], [192, 16]);
  assert.deepEqual(frameOf(strip, 0, 24), (await decode(join(root, `${ELEMENTS}/${ELEMENT}.png`))).data);
  assert.equal(result.json.gate.ok, true, JSON.stringify(result.json.gate));
});

test("a 5xx inference_failed is retried up to 3 times with a different idempotency key each time", async () => {
  const root = tree();
  retroDiffusionState.submitQueue.push(INFERENCE_FAILED, INFERENCE_FAILED, INFERENCE_FAILED);
  const result = await run(root, "--service", "retro-diffusion");
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const keys = retroDiffusionState.submits.map((s) => s.idempotencyKey);
  assert.equal(keys.length, 4);
  assert.ok(keys.every((k) => typeof k === "string" && k.length > 0));
  assert.equal(new Set(keys).size, 4, "a retry reused an idempotency key");
  assert.equal(result.json.retries.length, 3);
});

test("a fourth inference_failed in a row ends the Attempt with an error", async () => {
  const root = tree();
  retroDiffusionState.submitQueue.push(INFERENCE_FAILED, INFERENCE_FAILED, INFERENCE_FAILED, INFERENCE_FAILED);
  const result = await run(root, "--service", "retro-diffusion");
  assert.equal(result.code, 1);
  assert.equal(result.json.ok, false);
  assert.match(result.json.error, /inference_failed/);
  assert.equal(retroDiffusionState.submits.length, 4);
});

test("a task that fails with inference_failed is retried with a fresh key", async () => {
  const root = tree();
  retroDiffusionState.failTasks = 1;
  const result = await run(root, "--service", "retro-diffusion");
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const keys = retroDiffusionState.submits.map((s) => s.idempotencyKey);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});

test("a PixelLab 5xx is retried at once", async () => {
  const root = tree();
  pixellabState.animateQueue.push({ status: 503, json: { detail: "Service unavailable" } });
  const result = await run(root);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(pixellabState.animateRequests.length, 2);
  assert.equal(result.json.retries.length, 1);
});

test("the PixelLab fixture rejects a frame_count animate v3 rejects", async () => {
  const root = tree();
  const still = readFileSync(join(root, `${ELEMENTS}/${ELEMENT}.png`)).toString("base64");
  for (const [frameCount, status] of [[3, 422], [18, 422], [2, 422], [4, 200], [16, 200]]) {
    const res = await fetch(`${server.env.PIXELLAB_BASE_URL}/animate-with-text-v3`, {
      method: "POST",
      headers: { authorization: `Bearer ${server.env.PIXELLAB_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ first_frame: { type: "base64", base64: still, format: "png" }, action: "breathing", frame_count: frameCount }),
    });
    assert.equal(res.status, status, `frame_count ${frameCount}`);
  }
});

test("a request the service rejects as invalid is not retried", async () => {
  const root = tree();
  retroDiffusionState.submitQueue.push({ status: 400, json: { detail: "input_image too small" } });
  const result = await run(root, "--service", "retro-diffusion");
  assert.equal(result.code, 1);
  assert.equal(retroDiffusionState.submits.length, 1);
});

test("--accept writes the sidecar strip and the animation block, and validate checks the strip against the record", async () => {
  const root = tree();
  const first = await run(root, "--motion", "tail twitches", "--seed", "41");
  const accepted = await run(root, "--accept", first.json.scratch.strip);
  assert.equal(accepted.code, 0, accepted.stdout + accepted.stderr);
  assert.equal(accepted.json.strip, `${ELEMENTS}/${ELEMENT}.strip.png`);

  assert.deepEqual(readFileSync(join(root, `${ELEMENTS}/${ELEMENT}.strip.png`)), readFileSync(join(root, first.json.scratch.strip)));
  const record = readJson(root, `${ELEMENTS}/${ELEMENT}.json`);
  assert.deepEqual(record.animation, {
    frames: 5,
    fps: 6,
    order: "cycle",
    service: "pixellab",
    model: "animate-with-text-v3",
    prompt: "tail twitches",
    seed: 41,
    params: { frame_count: 4, no_background: true },
    snappedTo: "cosy-night",
    offPaletteBefore: 0,
    cost: { pixellabGenerations: 1, meteredUsd: 0 },
    checks: { attempt: 1, passed: ["dimensions", "alpha", "palette", "motion", "drift", "seam"], warnings: [] },
  });
  const valid = validate(root);
  assert.equal(valid.code, 0, JSON.stringify(valid.report));

  const narrow = await sharp(join(root, first.json.scratch.strip)).extract({ left: 0, top: 0, width: 96, height: 16 }).png().toBuffer();
  writeFileSync(join(root, `${ELEMENTS}/${ELEMENT}.strip.png`), narrow);
  const invalid = validate(root);
  assert.equal(invalid.code, 1);
  assert.match(JSON.stringify(invalid.report), /Frame strip .*is 96x16, record says 120x16/);
});

test("--accept records the off-palette share and warning, and charges every Attempt for the Element", async () => {
  const root = tree();
  await run(root, "--service", "retro-diffusion");
  const second = await run(root, "--service", "retro-diffusion", "--motion", OFF_PALETTE_ACTION);
  assert.equal(second.json.attempt, 2);
  const accepted = await run(root, "--accept", second.json.scratch.strip);
  assert.equal(accepted.code, 0, accepted.stdout + accepted.stderr);
  const { animation } = readJson(root, `${ELEMENTS}/${ELEMENT}.json`);
  assert.equal(animation.frames, 8);
  assert.equal(animation.service, "retro-diffusion");
  assert.equal(animation.model, "rd_advanced_animation__subtle_motion");
  assert.equal(animation.offPaletteBefore, 0.875);
  assert.deepEqual(animation.checks.warnings, ["87.5% of opaque pixels were off the Palette before snapping"]);
  assert.equal(animation.checks.attempt, 2);
  assert.deepEqual(animation.cost, { pixellabGenerations: 0, meteredUsd: 0.5 });
});

test("--accept with --scene adds the strip's cost to the Scene plan", async () => {
  const root = tree();
  await run(root, "--service", "retro-diffusion");
  const pl = await run(root);
  const accepted = await run(root, "--accept", pl.json.scratch.strip, "--scene", fixtureScene);
  assert.equal(accepted.code, 0, accepted.stdout + accepted.stderr);
  const { cost } = readJson(root, fixtureScene);
  assert.equal(cost.pixellabGenerations, 4 + 1);
  assert.deepEqual(cost.meteredUsd, { stability: 0.2, "retro-diffusion": 0.25 });
});

test("--accept refuses an Attempt that failed the gate and an Element that already has a strip", async () => {
  const root = tree();
  const { still, opaque } = await stillOf(root);
  const frozen = recolour(still, opaque.slice(0, 6));
  const action = "frozen";
  pixellabState.animations.set(action, [still, frozen, frozen, frozen, frozen].map((f) => encodePng(f.width, f.height, f.data)));
  const failed = await run(root, "--motion", action);
  assert.equal(failed.json.gate.ok, false);
  const refused = await run(root, "--accept", failed.json.scratch.strip);
  assert.equal(refused.code, 1);
  assert.match(refused.json.error, /failed the strip Quality gate: motion/);

  const good = await run(root);
  assert.equal((await run(root, "--accept", good.json.scratch.strip)).code, 0);
  const again = await run(root, "--accept", good.json.scratch.strip);
  assert.equal(again.code, 1);
  assert.match(again.json.error, /already has a Frame strip/);
  const another = await run(root);
  assert.equal(another.code, 1);
  assert.match(another.json.error, /already has a Frame strip/);
});

test("a backdrop gets no Frame strip", async () => {
  const root = tree();
  const result = await runScript(script, ["skyline-night-warm-windows-01"], { cwd: root, env: server.env });
  assert.equal(result.code, 1);
  assert.match(result.json.error, /backdrop/);
  assert.equal(pixellabState.animateRequests.length, 0);
});

test("a Placement with animation overrides on the accepted Element passes validate and plays the strip", async () => {
  const root = tree();
  const first = await run(root);
  assert.equal((await run(root, "--accept", first.json.scratch.strip)).code, 0);
  editJson(root, fixtureScene, (plan) => {
    for (const layer of plan.layers) for (const p of layer.placements ?? []) if (p.element === "cat-tabby-asleep-01") p.element = ELEMENT;
    plan.primitives = [];
  });
  const plan = scenePlanSchema.parse(readJson(root, fixtureScene));
  const cat = plan.layers.flatMap((l) => l.placements ?? []).find((p) => p.id === "cat")!;
  assert.deepEqual(cat.animation, { fps: 4, order: "pingpong" });
  const valid = validate(root);
  assert.equal(valid.code, 0, JSON.stringify(valid.report));

  const compositor = createCompositor({ plan, elements: await loadElementPixels(root, plan), palette: loadPalette(root, plan.palette) });
  const seen = new Set<string>();
  for (let t = 0; t < 1500; t += 250) {
    const frame = compositor.render(t);
    const rows: number[] = [];
    for (let y = cat.y; y < cat.y + 16; y++) rows.push(...frame.subarray((y * 192 + cat.x) * 4, (y * 192 + cat.x + 24) * 4));
    seen.add(rows.join(","));
  }
  assert.equal(seen.size, 5, "a 5-frame pingpong strip shows all five frames over one cycle");
});

// The fixture Scene plans no generated Element, so an approved overage gives its strips a generation budget.
function placeIn(root: string, ids: string[]): void {
  editJson(root, fixtureScene, (plan) => {
    plan.primitives = [];
    plan.cost.approvedOverage = { reason: "strips for library Elements", pixellabGenerations: 20 };
    const room = plan.layers.find((l: any) => l.name === "room") ?? plan.layers[plan.layers.length - 1];
    room.placements = room.placements.filter((p: any) => p.element !== "cat-tabby-asleep-01");
    room.placements.push(...ids.map((id, k) => ({ id: `prop-${k}`, element: id, x: 10 + k * 30, y: 90, animation: { fps: 4 } })));
  });
}

function copyProp(root: string, id: string): void {
  const record = readJson(root, `${ELEMENTS}/${ELEMENT}.json`);
  writeJson(root, `${ELEMENTS}/${id}.json`, { ...record, id });
  copyFileSync(join(root, `${ELEMENTS}/${ELEMENT}.png`), join(root, `${ELEMENTS}/${id}.png`));
}

const runFor = (root: string, id: string, ...args: string[]) => runScript(script, [id, ...args], { cwd: root, env: server.env });
const budgetOf = async (root: string) => (await runScript(join(repo, "pipeline/budget.ts"), [fixtureScene], { cwd: root, env: server.env })).json;

test("with --scene, a third Retro Diffusion Attempt on one prop is refused before the service is called", async () => {
  const root = tree();
  placeIn(root, [ELEMENT]);
  for (let k = 0; k < 2; k++) { const r = await run(root, "--service", "retro-diffusion", "--scene", fixtureScene); assert.equal(r.code, 0, r.stdout + r.stderr); }
  const third = await run(root, "--service", "retro-diffusion", "--scene", fixtureScene);
  assert.equal(third.code, 1);
  assert.match(third.json.error, /Retro Diffusion: cat-tabby-twitching-01 has had 2 of 2 charged Attempts/);
  assert.equal(retroDiffusionState.submits.length, 2);
  assert.equal((await run(root, "--scene", fixtureScene)).code, 0, "PixelLab is still allowed");
});

test("with --scene, a Retro Diffusion strip on a fifth prop is refused", async () => {
  const root = tree();
  const ids = ["cat-tabby-a-01", "cat-tabby-b-01", "cat-tabby-c-01", "cat-tabby-d-01", "cat-tabby-e-01"];
  ids.forEach((id) => copyProp(root, id));
  placeIn(root, ids);
  editJson(root, fixtureScene, (plan) => { plan.cost.approvedOverage.meteredUsd = 1; });
  for (const id of ids.slice(0, 4)) assert.equal((await runFor(root, id, "--service", "retro-diffusion", "--scene", fixtureScene)).code, 0);
  const fifth = await runFor(root, ids[4], "--service", "retro-diffusion", "--scene", fixtureScene);
  assert.equal(fifth.code, 1);
  assert.match(fifth.json.error, /Retro Diffusion: 4 of 4 props/);
});

test("with --scene, any strip is refused once the Scene's metered budget is spent", async () => {
  const root = tree();
  placeIn(root, [ELEMENT]);
  editJson(root, fixtureScene, (plan) => { plan.cost.meteredUsd = { "stable-audio-3": 0.9, "retro-diffusion": 0.1 }; });
  const result = await run(root, "--service", "retro-diffusion", "--scene", fixtureScene);
  assert.equal(result.code, 1);
  assert.match(result.json.error, /Scene budget reached: metered: \$1 used of \$1/);
});

test("accepting with --scene charges the strip Attempts once, so the budget shows nothing pending", async () => {
  const root = tree();
  placeIn(root, [ELEMENT]);
  await run(root, "--service", "retro-diffusion", "--scene", fixtureScene);
  assert.equal((await budgetOf(root)).meteredUsd.used, 0.45);
  const second = await run(root, "--scene", fixtureScene);
  assert.equal((await run(root, "--accept", second.json.scratch.strip, "--scene", fixtureScene)).code, 0);
  const report = await budgetOf(root);
  assert.equal(report.pixellabGenerations.pending, 0);
  assert.equal(report.pixellabGenerations.charged, 5);
  assert.equal(report.meteredUsd.used, 0.45);
});

test("--abandon --scene falls back to the still: it charges the strip Attempts, drops the animation overrides and logs it", async () => {
  const root = tree();
  placeIn(root, [ELEMENT]);
  await run(root, "--scene", fixtureScene);
  await run(root, "--service", "retro-diffusion", "--scene", fixtureScene);
  const result = await run(root, "--abandon", "--scene", fixtureScene);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.outcome, "still");
  assert.equal(result.json.attempts, 2);

  const plan = readJson(root, fixtureScene);
  const prop = plan.layers.flatMap((l: any) => l.placements ?? []).find((p: any) => p.id === "prop-0");
  assert.equal(prop.element, ELEMENT);
  assert.equal(prop.animation, undefined);
  assert.equal(plan.cost.pixellabGenerations, 4 + 1);
  assert.deepEqual(plan.cost.meteredUsd, { stability: 0.2, "retro-diffusion": 0.25 });
  assert.equal(plan.cost.attemptsAbandoned, 2);
  assert.equal(readJson(root, `${ELEMENTS}/${ELEMENT}.json`).animation, undefined);
  assert.deepEqual(readJson(root, "scratch/attempts/fixture-rainy-desk-a1b2/abandoned.json"),
    [{ placement: "prop-0", element: ELEMENT, attempts: 2, outcome: "still" }]);
  assert.equal((await budgetOf(root)).pixellabGenerations.pending, 0);
  assert.equal(validate(root).code, 0);
});
