import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import sharp from "sharp";
import { fixtures, makeTree, readJson, repo, validate, writeJson } from "./helpers.ts";
import { runScript, startFixtureServer, type FixtureServer } from "./fixture-server.ts";
import { encodePng, pixellabState } from "./fixtures/services/pixellab.ts";

const script = join(repo, "pipeline/generate-element.ts");
const PLAN = "scenes/rainy-desk-night-k7f2/scene.json";
const COSY = JSON.parse(readFileSync(join(repo, "library/palettes/cosy-night.json"), "utf8")).colours as string[];

let server: FixtureServer;
before(async () => { server = await startFixtureServer(); });
after(() => server.close());
beforeEach(() => pixellabState.reset());

function tree(edit: (plan: any) => void = () => {}): string {
  const root = makeTree();
  const plan = JSON.parse(readFileSync(join(fixtures, "spec-example-scene.json"), "utf8"));
  edit(plan);
  writeJson(root, PLAN, plan);
  return root;
}

const run = (root: string, ...args: string[]) => runScript(script, [PLAN, ...args], { cwd: root, env: server.env });

test("one run writes the raw PNG and an 8x upscale to scratch and prints a gate report", async () => {
  const root = tree();
  const result = await run(root, "cat");
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.placement, "cat");
  assert.equal(result.json.attempt, 1);
  assert.deepEqual(result.json.canvas, { width: 24, height: 16 });
  assert.deepEqual(result.json.gate.failed, []);
  assert.deepEqual(result.json.gate.passed, ["dimensions", "alpha", "palette"]);
  assert.equal(result.json.gate.ok, true);

  const { png, upscale } = result.json.scratch;
  assert.match(png, /^scratch\//);
  const raw = await sharp(join(root, png)).metadata();
  assert.deepEqual([raw.width, raw.height], [24, 16]);
  const big = await sharp(join(root, upscale)).metadata();
  assert.deepEqual([big.width, big.height], [192, 128]);
});

const placementIn = (plan: any, id: string) => plan.layers.flatMap((l: any) => l.placements ?? []).find((p: any) => p.id === id);

test("--accept moves the Attempt into the library, writes the record and rewrites the plan's generate block", async () => {
  const root = tree((plan) => { placementIn(plan, "cat").element = "cat-tabby-curled-01"; });
  const first = await run(root, "cat", "--seed", "77");
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const accepted = await run(root, "cat", "--accept", first.json.scratch.png);
  assert.equal(accepted.code, 0, accepted.stdout + accepted.stderr);
  assert.equal(accepted.json.element, "cat-tabby-curled-01");

  assert.deepEqual(readFileSync(join(root, "library/elements/cat-tabby-curled-01.png")), readFileSync(join(root, first.json.scratch.png)));
  const record = readJson(root, "library/elements/cat-tabby-curled-01.json");
  assert.equal(record.id, "cat-tabby-curled-01");
  assert.equal(record.kind, "prop");
  assert.deepEqual([record.width, record.height], [24, 16]);
  assert.deepEqual(record.realSize, { w: 0.5, h: 0.25 });
  assert.equal(record.transparent, true);
  assert.equal(record.subject, "cat");
  assert.deepEqual(record.tags, ["cat", "asleep"]);
  assert.equal(record.brief, "tabby cat asleep, curled up");
  assert.equal(record.prompt, "tabby cat asleep, curled up");
  assert.equal(record.service, "pixellab");
  assert.equal(record.seed, 77);
  assert.equal(record.palette, "cosy-night");
  assert.equal(record.styleAnchor, null);
  assert.equal(record.firstScene, "rainy-desk-night-k7f2");
  assert.deepEqual(record.cost, { pixellabGenerations: 5, meteredUsd: 0 });
  assert.deepEqual(record.checks, { attempt: 1, passed: ["dimensions", "alpha", "palette"], warnings: [] });

  const plan = readJson(root, PLAN);
  const cat = placementIn(plan, "cat");
  assert.equal(cat.element, "cat-tabby-curled-01");
  assert.equal(cat.generate, undefined);
  assert.equal(cat.x, 140);
  assert.equal(plan.cost.pixellabGenerations, 5);
  assert.deepEqual(cat.animation, { fps: 4, order: "cycle" });
  assert.equal("animationRemoved" in accepted.json, false);
  assert.deepEqual(accepted.json.stripRequested, { service: "pixellab", frames: 5 });

  const check = validate(root);
  assert.equal(check.code, 0, check.stderr);
});

test("--accept reports a planned strip with no frames at the PixelLab default of 5", async () => {
  const root = tree((plan) => { placementIn(plan, "cat").generate.strip = { service: "pixellab" }; });
  const first = await run(root, "cat");
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const accepted = await run(root, "cat", "--accept", first.json.scratch.png);
  assert.equal(accepted.code, 0, accepted.stdout + accepted.stderr);
  assert.deepEqual(accepted.json.stripRequested, { service: "pixellab", frames: 5 });
});

test("--accept bumps the id suffix when the proposed id is already in the library", async () => {
  const root = tree();
  const first = await run(root, "cat");
  const accepted = await run(root, "cat", "--accept", first.json.scratch.png);
  assert.equal(accepted.code, 0, accepted.stdout + accepted.stderr);
  assert.equal(accepted.json.element, "cat-tabby-asleep-02");
  assert.equal(readJson(root, "library/elements/cat-tabby-asleep-02.json").id, "cat-tabby-asleep-02");
  assert.equal(readJson(root, "library/elements/cat-tabby-asleep-01.json").width, 24);
  assert.equal(placementIn(readJson(root, PLAN), "cat").element, "cat-tabby-asleep-02");
  assert.equal(validate(root).code, 0);
});

const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

type Rect = { x: number; y: number; w: number; h: number; colour?: string; alpha?: number };

function handMade(width: number, height: number, rects: Rect[]): Buffer {
  const data = new Uint8Array(width * height * 4);
  for (const r of rects) {
    const [red, green, blue] = rgb(r.colour ?? COSY[5]);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) data.set([red, green, blue, r.alpha ?? 255], (y * width + x) * 4);
  }
  return encodePng(width, height, data);
}

async function gateOf(root: string, placement: string, png: Buffer) {
  const brief = `hand-made ${pixellabState.images.size}`;
  pixellabState.images.set(brief, png);
  const result = await run(root, placement, "--brief", brief);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return result.json.gate;
}

const CAT_FULL = { x: 0, y: 2, w: 24, h: 12 };

test("a canvas of the wrong size is a hard fail", async () => {
  const gate = await gateOf(tree(), "cat", handMade(20, 16, [{ x: 0, y: 2, w: 20, h: 12 }]));
  assert.equal(gate.ok, false);
  assert.deepEqual(gate.passed, ["alpha", "palette"]);
  assert.deepEqual(gate.failed, ["dimensions: 20x16, derived canvas is 24x16"]);
});

test("any alpha other than 0 or 255 is a hard fail", async () => {
  const gate = await gateOf(tree(), "cat", handMade(24, 16, [CAT_FULL, { x: 3, y: 3, w: 1, h: 1, alpha: 128 }]));
  assert.equal(gate.ok, false);
  assert.deepEqual(gate.failed, ["alpha: 1 pixels with alpha other than 0 or 255"]);
});

test("an opaque pixel outside the Palette is a hard fail", async () => {
  const gate = await gateOf(tree(), "cat", handMade(24, 16, [CAT_FULL, { x: 4, y: 4, w: 2, h: 1, colour: "#ff00ff" }]));
  assert.equal(gate.ok, false);
  assert.deepEqual(gate.failed, ["palette: 2 opaque pixels not in the Palette"]);
});

test("a transparent pixel's colour is ignored by the Palette check", async () => {
  const gate = await gateOf(tree(), "cat", handMade(24, 16, [CAT_FULL, { x: 0, y: 0, w: 1, h: 1, colour: "#ff00ff", alpha: 0 }]));
  assert.equal(gate.ok, true);
  assert.deepEqual(gate.warnings, []);
});

test("a trimmed box under 0.7x the target box warns", async () => {
  const gate = await gateOf(tree(), "cat", handMade(24, 16, [{ x: 7, y: 5, w: 10, h: 6 }]));
  assert.equal(gate.ok, true);
  assert.deepEqual(gate.warnings, ["trimmed box 10x6 is outside 0.7x to 1.5x the target box 24x12"]);
});

test("a trimmed box over 1.5x the target box warns", async () => {
  const root = tree((plan) => { placementIn(plan, "cat").generate.realSize = { w: 0.2, h: 0.2 }; });
  const gate = await gateOf(root, "cat", handMade(16, 16, [{ x: 0, y: 0, w: 16, h: 16 }]));
  assert.equal(gate.ok, true);
  assert.deepEqual(gate.warnings, ["trimmed box 16x16 is outside 0.7x to 1.5x the target box 9.6x9.6"]);
});

test("a trimmed box at the edges of the band does not warn", async () => {
  const gate = await gateOf(tree(), "cat", handMade(24, 16, [{ x: 0, y: 0, w: 17, h: 16 }]));
  assert.deepEqual(gate.warnings, []);
});

test("more than 2 disconnected opaque islands warns", async () => {
  const three = [{ x: 0, y: 2, w: 6, h: 12 }, { x: 9, y: 2, w: 6, h: 12 }, { x: 18, y: 2, w: 6, h: 12 }];
  const gate = await gateOf(tree(), "cat", handMade(24, 16, three));
  assert.equal(gate.ok, true);
  assert.deepEqual(gate.warnings, ["3 disconnected opaque islands"]);
  const two = await gateOf(tree(), "cat", handMade(24, 16, three.slice(0, 2).concat({ x: 15, y: 8, w: 3, h: 1 })));
  assert.deepEqual(two.warnings, []);
});

test("pixels touching only at a corner are separate islands", async () => {
  const diagonal = [{ x: 0, y: 2, w: 8, h: 6 }, { x: 8, y: 8, w: 8, h: 6 }, { x: 16, y: 2, w: 8, h: 6 }];
  const gate = await gateOf(tree(), "cat", handMade(24, 16, diagonal));
  assert.deepEqual(gate.warnings, ["3 disconnected opaque islands"]);
});

test("a backdrop with transparent pixels warns", async () => {
  const gate = await gateOf(tree(), "skyline", handMade(128, 64, [{ x: 0, y: 0, w: 128, h: 64 }, { x: 10, y: 10, w: 4, h: 2, alpha: 0 }]));
  assert.equal(gate.ok, true);
  assert.deepEqual(gate.warnings, ["backdrop has 8 transparent pixels"]);
});

test("a fully opaque backdrop passes with no warnings", async () => {
  const gate = await gateOf(tree(), "skyline", handMade(128, 64, [{ x: 0, y: 0, w: 128, h: 64 }]));
  assert.equal(gate.ok, true);
  assert.deepEqual(gate.warnings, []);
});

const sentBodies = () => server.requests
  .filter((r) => r.service === "pixellab" && r.method === "POST")
  .map((r) => JSON.parse(r.body.toString("utf8")));

test("style_image with all four style_options is sent only when the Style anchor fits the canvas", async () => {
  server.requests.length = 0;
  const root = tree((plan) => { placementIn(plan, "skyline").element = "skyline-city-dusk-01"; });
  const skyline = await run(root, "skyline");
  assert.equal(skyline.code, 0, skyline.stdout + skyline.stderr);
  const cat = await run(root, "cat");
  assert.equal(cat.code, 0, cat.stdout + cat.stderr);

  const [backdrop, prop] = sentBodies();
  const anchorPng = readFileSync(join(root, "library/elements/window-wood-transparent-panes-01.png"));
  assert.deepEqual(backdrop.image_size, { width: 128, height: 64 });
  assert.equal(backdrop.no_background, false);
  assert.deepEqual(backdrop.target_palette, { colors: COSY, name: "cosy-night" });
  assert.equal(backdrop.style_image.image.base64, anchorPng.toString("base64"));
  assert.deepEqual(backdrop.style_image.size, { width: 48, height: 48 });
  assert.deepEqual(backdrop.style_options, { color_palette: true, outline: true, detail: true, shading: true });
  assert.deepEqual(skyline.json.styleImage, { sent: true, anchor: "window-wood-transparent-panes-01" });

  assert.deepEqual(prop.image_size, { width: 24, height: 16 });
  assert.equal(prop.no_background, true);
  assert.equal(prop.style_image, undefined);
  assert.equal(prop.style_options, undefined);
  assert.deepEqual(cat.json.styleImage, { sent: false, anchor: "window-wood-transparent-panes-01" });

  const accepted = await run(root, "skyline", "--accept", skyline.json.scratch.png);
  assert.equal(accepted.code, 0, accepted.stdout + accepted.stderr);
  const record = readJson(root, "library/elements/skyline-city-dusk-01.json");
  assert.equal(record.kind, "backdrop");
  assert.equal(record.transparent, false);
  assert.equal(record.styleAnchor, "window-wood-transparent-panes-01");
  assert.deepEqual(record.params, { no_background: false, style_options: { color_palette: true, outline: true, detail: true, shading: true } });
  assert.equal(validate(root).code, 0);
});

test("a plan with no Style anchor sends no style_image", async () => {
  server.requests.length = 0;
  const root = tree((plan) => { plan.styleAnchor = null; });
  const result = await run(root, "skyline");
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(sentBodies()[0].style_image, undefined);
  assert.deepEqual(result.json.styleImage, { sent: false, anchor: null });
});

test("the 422 'style image must fit' surfaces as a clear error and writes nothing", async () => {
  pixellabState.queue.push({
    status: 422,
    json: { detail: "1 validation error for RequestGenerateImageProFlash\n  Value error, Style image must fit the native canvas. Crop the reference or choose a larger supported canvas." },
  });
  const root = tree();
  const result = await run(root, "skyline");
  assert.equal(result.code, 1);
  assert.equal(result.json.ok, false);
  assert.equal(result.json.error,
    "PixelLab rejected the Style anchor window-wood-transparent-panes-01 (48x48): it must fit the 128x64 canvas. Send this Attempt without a style image or choose a smaller anchor.");
  assert.equal(existsSync(join(root, "scratch/attempts")), false);
});

test("twelve parallel invocations keep at most 8 PixelLab jobs in flight and all succeed", async () => {
  const root = tree();
  const runs = await Promise.all(Array.from({ length: 12 }, (_, i) => run(root, "cat", "--attempt", String(i + 1))));
  for (const r of runs) assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(pixellabState.created, 12);
  assert.ok(pixellabState.peakInFlight <= 8, `peak ${pixellabState.peakInFlight} jobs in flight`);
  assert.equal(pixellabState.served429, 0);
  assert.deepEqual(readdirSync(join(root, "scratch/pixellab-jobs")), []);
});

test("a 429 concurrency cap from PixelLab is waited out and the Attempt retried", async () => {
  pixellabState.queue.push({ status: 429, json: { detail: "Maximum 8 concurrent background jobs allowed (Tier 1)" } });
  const result = await run(tree(), "cat");
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(pixellabState.served429, 1);
  assert.equal(pixellabState.created, 1);
  assert.equal(result.json.gate.ok, true);
});

const SLOTS = "scratch/pixellab-jobs";

function holdAllSlots(root: string, pid: number): void {
  mkdirSync(join(root, SLOTS), { recursive: true });
  for (let k = 0; k < 8; k++) writeFileSync(join(root, SLOTS, `slot-${k}.lock`), String(pid));
}

test("a run waits while 8 live jobs hold the lock file slots and goes ahead when one is freed", async () => {
  const root = tree();
  holdAllSlots(root, process.pid);
  const pending = run(root, "cat");
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(pixellabState.created, 0);
  rmSync(join(root, SLOTS, "slot-3.lock"));
  const result = await pending;
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(pixellabState.created, 1);
});

test("slots left by a process that has exited are reclaimed", async () => {
  const root = tree();
  const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  holdAllSlots(root, Number(gone.stdout));
  const result = await run(root, "cat");
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(pixellabState.created, 1);
});

const libraryFiles = (root: string) => readdirSync(join(root, "library/elements")).sort();

test("an Attempt alone changes neither the library nor the plan", async () => {
  const root = tree();
  const before = { files: libraryFiles(root), plan: readFileSync(join(root, PLAN), "utf8") };
  const result = await run(root, "cat");
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(libraryFiles(root), before.files);
  assert.equal(readFileSync(join(root, PLAN), "utf8"), before.plan);
});

test("--accept refuses an Attempt that failed the Quality gate and leaves it in scratch", async () => {
  const root = tree();
  pixellabState.images.set("off palette", handMade(24, 16, [{ ...CAT_FULL, colour: "#ff00ff" }]));
  const rejected = await run(root, "cat", "--brief", "off palette");
  assert.equal(rejected.json.gate.ok, false);
  const before = { files: libraryFiles(root), plan: readFileSync(join(root, PLAN), "utf8") };

  const accepted = await run(root, "cat", "--accept", rejected.json.scratch.png);
  assert.equal(accepted.code, 1);
  assert.match(accepted.json.error, /failed the Quality gate: palette: 288 opaque pixels not in the Palette/);
  assert.deepEqual(libraryFiles(root), before.files);
  assert.equal(readFileSync(join(root, PLAN), "utf8"), before.plan);
  assert.ok(existsSync(join(root, rejected.json.scratch.png)));
  assert.ok(existsSync(join(root, rejected.json.scratch.upscale)));
});

test("--accept refuses an Attempt made for another Placement", async () => {
  const root = tree();
  const skyline = await run(root, "skyline");
  const accepted = await run(root, "cat", "--accept", skyline.json.scratch.png);
  assert.equal(accepted.code, 1);
  assert.match(accepted.json.error, /is an Attempt for rainy-desk-night-k7f2\/skyline, not rainy-desk-night-k7f2\/cat/);
});

test("Attempts are written under the gitignored scratch folder", async () => {
  const root = tree();
  const result = await run(root, "cat");
  for (const path of Object.values(result.json.scratch) as string[]) {
    const ignored = spawnSync("git", ["check-ignore", "-q", path], { cwd: repo });
    assert.equal(ignored.status, 0, `${path} is not gitignored`);
  }
});

test("accepting charges every Attempt the Placement took to the plan's cost", async () => {
  const root = tree((plan) => { placementIn(plan, "cat").element = "cat-tabby-curled-01"; });
  await run(root, "cat", "--attempt", "1");
  const second = await run(root, "cat", "--attempt", "2");
  const accepted = await run(root, "cat", "--accept", second.json.scratch.png);
  assert.equal(accepted.code, 0, accepted.stdout + accepted.stderr);
  assert.equal(accepted.json.generationsAdded, 10);
  assert.equal(readJson(root, PLAN).cost.pixellabGenerations, 10);
  assert.deepEqual(readJson(root, "library/elements/cat-tabby-curled-01.json").cost, { pixellabGenerations: 5, meteredUsd: 0 });
  assert.equal(readJson(root, "library/elements/cat-tabby-curled-01.json").checks.attempt, 2);
});

test("runs without --attempt take the next free number, so accepting still charges every Attempt", async () => {
  const root = tree((plan) => { placementIn(plan, "cat").element = "cat-tabby-curled-01"; });
  const first = await run(root, "cat");
  const second = await run(root, "cat");
  assert.equal(first.json.attempt, 1);
  assert.equal(second.json.attempt, 2);
  const accepted = await run(root, "cat", "--accept", second.json.scratch.png);
  assert.equal(accepted.code, 0, accepted.stdout + accepted.stderr);
  assert.equal(readJson(root, PLAN).cost.pixellabGenerations, 10);
});

test("--attempt n refuses an Attempt number already in scratch before calling PixelLab", async () => {
  const root = tree();
  await run(root, "cat", "--attempt", "3");
  const again = await run(root, "cat", "--attempt", "3");
  assert.equal(again.code, 1);
  assert.match(again.json.error, /Attempt 3 of rainy-desk-night-k7f2\/cat is already in scratch/);
  assert.equal(pixellabState.created, 1);
});

const withLamp = (plan: any) => {
  plan.styleAnchor = null;
  placementIn(plan, "window").x = 64;
  plan.layers[2].placements.push({ id: "lamp", element: "lamp-brass-desk-01", x: 20, y: 60,
    generate: { brief: "brass desk lamp", kind: "prop", realSize: { w: 1, h: 1 }, tags: ["lamp"] } });
};

test("--accept --style-anchor makes the accepted prop the plan's Style anchor", async () => {
  const root = tree(withLamp);
  const first = await run(root, "lamp");
  assert.equal(first.code, 0, first.stdout + first.stderr);
  const accepted = await run(root, "lamp", "--accept", first.json.scratch.png, "--style-anchor");
  assert.equal(accepted.code, 0, accepted.stdout + accepted.stderr);
  assert.equal(accepted.json.styleAnchor, "lamp-brass-desk-01");
  assert.equal(readJson(root, PLAN).styleAnchor, "lamp-brass-desk-01");

  server.requests.length = 0;
  const skyline = await run(root, "skyline");
  assert.deepEqual(skyline.json.styleImage, { sent: true, anchor: "lamp-brass-desk-01" });
  assert.equal(validate(root).code, 0);
});

test("--style-anchor refuses a backdrop and a prop under 48 px on its longer side", async () => {
  const root = tree(withLamp);
  const skyline = await run(root, "skyline");
  const backdrop = await run(root, "skyline", "--accept", skyline.json.scratch.png, "--style-anchor");
  assert.equal(backdrop.code, 1);
  assert.match(backdrop.json.error, /Style anchor must be a prop, not a backdrop/);
  const cat = await run(root, "cat");
  const small = await run(root, "cat", "--accept", cat.json.scratch.png, "--style-anchor");
  assert.equal(small.code, 1);
  assert.match(small.json.error, /Style anchor must be at least 48 px on its longer side; cat is 24x16/);
  const plan = readJson(root, PLAN);
  assert.equal(plan.styleAnchor, null);
  assert.ok(placementIn(plan, "cat").generate);
});

test("regenerating an accepted Placement charges only its new Attempts", async () => {
  const root = tree((plan) => { placementIn(plan, "cat").element = "cat-tabby-curled-01"; });
  await run(root, "cat");
  const second = await run(root, "cat");
  await run(root, "cat", "--accept", second.json.scratch.png);
  const plan = readJson(root, PLAN);
  const generate = readJson(root, "library/elements/cat-tabby-curled-01.json");
  placementIn(plan, "cat").generate = { brief: "tabby cat asleep, tail over nose", kind: "prop", realSize: generate.realSize, tags: generate.tags };
  writeJson(root, PLAN, plan);

  const again = await run(root, "cat");
  assert.equal(again.json.attempt, 3);
  const accepted = await run(root, "cat", "--accept", again.json.scratch.png);
  assert.equal(accepted.code, 0, accepted.stdout + accepted.stderr);
  assert.equal(accepted.json.element, "cat-tabby-curled-02");
  assert.equal(accepted.json.generationsAdded, 5);
  assert.equal(readJson(root, PLAN).cost.pixellabGenerations, 15);
});

async function failedAttempts(root: string, placement: string, count: number) {
  pixellabState.images.set("off palette", handMade(24, 16, [{ ...CAT_FULL, colour: "#ff00ff" }]));
  for (let k = 0; k < count; k++) {
    const r = await run(root, placement, "--brief", "off palette");
    assert.equal(r.json.gate.ok, false);
  }
}

const abandonLog = (root: string) => readJson(root, "scratch/attempts/rainy-desk-night-k7f2/abandoned.json");

test("--abandon with no substitute drops the Placement and the Primitives anchored to it, and charges its Attempts", async () => {
  const root = tree((plan) => {
    plan.primitives = [{ type: "twinkle", anchor: "cat", colours: [6] }, { type: "rain", region: { x: 0, y: 0, w: 10, h: 10 }, colours: [4] }];
  });
  await failedAttempts(root, "cat", 2);
  const result = await run(root, "cat", "--abandon");
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.outcome, "dropped");
  assert.equal(result.json.element, "cat-tabby-asleep-01");
  assert.deepEqual(result.json.droppedPrimitives, ["twinkle anchored to cat"]);

  const plan = readJson(root, PLAN);
  assert.equal(placementIn(plan, "cat"), undefined);
  assert.deepEqual(plan.primitives.map((p: any) => p.type), ["rain"]);
  assert.equal(plan.cost.pixellabGenerations, 10);
  assert.equal(plan.cost.attemptsAbandoned, 2);
  assert.deepEqual(abandonLog(root), [{ placement: "cat", element: "cat-tabby-asleep-01", attempts: 2, outcome: "dropped", droppedPrimitives: ["twinkle anchored to cat"] }]);
  assert.equal(validate(root).code, 0);
});

test("--abandon --substitute swaps the Placement to a matching library Element", async () => {
  const root = tree((plan) => { placementIn(plan, "cat").element = "cat-tabby-curled-01"; });
  await failedAttempts(root, "cat", 4);
  const result = await run(root, "cat", "--abandon", "--substitute", "cat-tabby-asleep-01");
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.outcome, "substituted");
  assert.equal(result.json.substitute, "cat-tabby-asleep-01");
  const cat = placementIn(readJson(root, PLAN), "cat");
  assert.equal(cat.element, "cat-tabby-asleep-01");
  assert.equal(cat.generate, undefined);
  assert.deepEqual(cat.animation, { fps: 4, order: "cycle" });
  assert.equal(readJson(root, PLAN).cost.attemptsAbandoned, 4);
  assert.deepEqual(abandonLog(root), [{ placement: "cat", element: "cat-tabby-curled-01", attempts: 4, outcome: "substituted", substitute: "cat-tabby-asleep-01" }]);
  assert.equal(validate(root).code, 0);
});

test("--abandon --substitute refuses an Element of another size and changes nothing", async () => {
  const root = tree();
  await failedAttempts(root, "cat", 1);
  const before = readFileSync(join(root, PLAN), "utf8");
  const result = await run(root, "cat", "--abandon", "--substitute", "window-wood-transparent-panes-01");
  assert.equal(result.code, 1);
  assert.match(result.json.error, /window-wood-transparent-panes-01 is 48x48, the derived canvas for cat is 24x16/);
  assert.equal(readFileSync(join(root, PLAN), "utf8"), before);
  assert.equal(existsSync(join(root, "scratch/attempts/rainy-desk-night-k7f2/abandoned.json")), false);
});

test("eight parallel abandons into one Scene all land in the abandoned log", async () => {
  const ids = Array.from({ length: 8 }, (_, k) => `mug-${k}`);
  const root = tree((plan) => {
    plan.layers[2].placements.push(...ids.map((id, k) => ({ id, element: `mug-white-plain${k}-01`, x: k * 10, y: 100,
      generate: { brief: "white mug", kind: "prop", realSize: { w: 0.1, h: 0.1 }, tags: ["mug"] } })));
  });
  const abandoned = await Promise.all(ids.map((id) => run(root, id, "--abandon")));
  for (const a of abandoned) assert.equal(a.code, 0, a.stdout + a.stderr);
  assert.deepEqual(abandonLog(root).map((entry: any) => entry.placement).sort(), ids);
});

test("eight parallel accepts into one plan all land in it", async () => {
  const ids = Array.from({ length: 8 }, (_, k) => `mug-${k}`);
  const root = tree((plan) => {
    plan.layers[2].placements.push(...ids.map((id, k) => ({ id, element: `mug-white-plain${k}-01`, x: k * 10, y: 100,
      generate: { brief: "white mug", kind: "prop", realSize: { w: 0.1, h: 0.1 }, tags: ["mug"] } })));
    plan.cost.approvedOverage = { reason: "eight mugs", pixellabGenerations: 40 };
  });
  const attempts = await Promise.all(ids.map((id) => run(root, id)));
  const accepted = await Promise.all(ids.map((id, k) => run(root, id, "--accept", attempts[k].json.scratch.png)));
  for (const a of accepted) assert.equal(a.code, 0, a.stdout + a.stderr);
  const plan = readJson(root, PLAN);
  for (const id of ids) assert.equal(placementIn(plan, id).generate, undefined, `${id} is resolved in the plan`);
  assert.equal(plan.cost.pixellabGenerations, 40);
});
