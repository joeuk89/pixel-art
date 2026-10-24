import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import ffmpeg from "ffmpeg-static";
import { join } from "node:path";
import { editJson, fixtureScene, makeTree, readJson, repo, validate } from "./helpers.ts";
import { runScript, startFixtureServer, type FixtureServer } from "./fixture-server.ts";
import { FAILING_BRIEF, SOUND_EFFECTS, UNDECODABLE_BRIEF } from "./fixtures/services/fal.ts";

const script = join(repo, "pipeline/ambient.ts");
const sceneDir = "scenes/fixture-rainy-desk-a1b2";
let server: FixtureServer;
before(async () => { server = await startFixtureServer(); });
after(() => server.close());

function tree(): string {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => {
    plan.status = "draft";
    plan.soundtrack.ambient = [
      { source: { kind: "curated", id: "freesound-rain-window-242889" }, file: "rain.ogg", distance: "near" },
      { source: { kind: "curated", id: "freesound-room-tone-641306" }, file: "room.ogg", distance: "mid" },
    ];
  });
  return root;
}

test("curated entries are copied beside the plan under the plan's file names", async () => {
  const root = tree();
  const run = await runScript(script, [fixtureScene], { cwd: root, env: server.env });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.json.ok, true);
  assert.deepEqual(run.json.entries.map((e: any) => [e.file, e.action]), [["rain.ogg", "copied"], ["room.ogg", "copied"], ["thunder.ogg", "copied"]]);
  for (const [file, record] of [["rain.ogg", "freesound-rain-window-242889"], ["room.ogg", "freesound-room-tone-641306"], ["thunder.ogg", "freesound-thunder-distant-195522"]]) {
    assert.deepEqual(readFileSync(join(root, sceneDir, file)), readFileSync(join(repo, "library/ambient", `${record}.ogg`)), file);
  }
  const check = validate(root, sceneDir);
  assert.equal(check.code, 0, check.stderr);
  assert.equal(check.report.scenes[0].status, "resolved");
});

test("a plan naming an unknown curated id fails with the slot and id named, and writes nothing", async () => {
  const root = tree();
  editJson(root, fixtureScene, (plan) => {
    plan.soundtrack.ambient[1].source.id = "freesound-no-such-sound-1";
  });
  const before = server.requests.length;
  const run = await runScript(script, [fixtureScene], { cwd: root, env: server.env });
  assert.equal(run.code, 1);
  assert.equal(run.json.ok, false);
  assert.equal(run.json.error, `${fixtureScene}: soundtrack.ambient[1].source.id: Sound library has no record freesound-no-such-sound-1`);
  assert.equal(existsSync(join(root, sceneDir, "rain.ogg")), false);
  assert.equal(server.requests.length, before);
});

test("a curated loop in a One-shot slot fails, naming the record's kind", async () => {
  const root = tree();
  editJson(root, fixtureScene, (plan) => {
    plan.soundtrack.oneshots[0].source.id = "freesound-room-tone-641306";
  });
  const run = await runScript(script, [fixtureScene], { cwd: root, env: server.env });
  assert.equal(run.code, 1);
  assert.equal(run.json.error, `${fixtureScene}: soundtrack.oneshots[0].source.id: freesound-room-tone-641306 is a loop, not a oneshot`);
});

function generatedTree(): string {
  const root = tree();
  editJson(root, fixtureScene, (plan) => {
    plan.soundtrack.ambient[0] = { source: { kind: "generated", service: "elevenlabs-fal", brief: "light rain on a window pane, steady, close" }, file: "rain.ogg", distance: "near" };
  });
  return root;
}

test("a generated loop writes an OGG beside the plan, a Sound library record and a metered cost", async () => {
  const root = generatedTree();
  const before = server.requests.length;
  const run = await runScript(script, [fixtureScene], { cwd: root, env: server.env });
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(run.json.entries.map((e: any) => [e.file, e.action]), [["rain.ogg", "generated"], ["room.ogg", "copied"], ["thunder.ogg", "copied"]]);

  const submit = server.requests.slice(before).find((r) => r.method === "POST");
  assert.equal(submit?.path, SOUND_EFFECTS);
  assert.equal(submit?.headers.authorization, "Key fixture-fal-key");
  assert.deepEqual(JSON.parse(submit!.body.toString()), {
    text: "light rain on a window pane, steady, close", loop: true, duration_seconds: 22, output_format: "opus_48000_128",
  });

  const plan = readJson(root, fixtureScene);
  const id = plan.soundtrack.ambient[0].source.id;
  assert.equal(id, "elevenlabs-rain-01");
  assert.deepEqual(plan.cost.meteredUsd, { stability: 0.2, fal: 0.028 });

  const record = readJson(root, `library/ambient/${id}.json`);
  assert.equal(record.kind, "loop");
  assert.deepEqual(record.distance, ["near"]);
  assert.equal(record.brief, "light rain on a window pane, steady, close");
  assert.equal(record.licenceUrl, "https://fal.ai/terms");
  assert.ok(record.licence.length > 0 && record.attribution.length > 0);
  assert.equal(record.file, `${id}.ogg`);
  assert.deepEqual(readFileSync(join(root, sceneDir, "rain.ogg")), readFileSync(join(root, "library/ambient", record.file)));

  const check = validate(root);
  assert.equal(check.code, 0, check.stderr);
  assert.equal(check.report.scenes[0].status, "resolved");
});

function levels(ogg: string, channels: number): { rmsDb: number; peakDb: number } {
  const raw = execFileSync(ffmpeg as unknown as string, ["-loglevel", "error", "-i", ogg, "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  let sq = 0, peak = 0;
  for (let i = 0; i < samples.length; i += channels) {
    let mix = 0;
    for (let c = 0; c < channels; c++) { mix += samples[i + c]; peak = Math.max(peak, Math.abs(samples[i + c])); }
    mix /= channels;
    sq += mix * mix;
  }
  return { rmsDb: 20 * Math.log10(Math.sqrt(sq / (samples.length / channels))), peakDb: 20 * Math.log10(peak) };
}

test("generated loops are written at -20 dBFS RMS and generated One-shots at -6 dBFS peak", async () => {
  const root = generatedTree();
  editJson(root, fixtureScene, (plan) => {
    plan.soundtrack.oneshots[0].source = { kind: "generated", service: "elevenlabs-fal", brief: "distant thunder, one long roll" };
  });
  const before = server.requests.length;
  const run = await runScript(script, [fixtureScene], { cwd: root, env: server.env });
  assert.equal(run.code, 0, run.stderr);

  const channels = (id: string) => readJson(root, `library/ambient/${id}.json`).channels;
  const loop = levels(join(root, sceneDir, "rain.ogg"), channels("elevenlabs-rain-01"));
  assert.ok(Math.abs(loop.rmsDb - -20) < 0.5, `loop RMS ${loop.rmsDb} dBFS`);
  const oneshot = levels(join(root, sceneDir, "thunder.ogg"), channels("elevenlabs-thunder-01"));
  assert.ok(Math.abs(oneshot.peakDb - -6) < 0.5, `One-shot peak ${oneshot.peakDb} dBFS`);

  const submits = server.requests.slice(before).filter((r) => r.method === "POST").map((r) => JSON.parse(r.body.toString()));
  assert.deepEqual(submits[1], { text: "distant thunder, one long roll", loop: false, output_format: "opus_48000_128" });

  const plan = readJson(root, fixtureScene);
  assert.equal(plan.soundtrack.oneshots[0].source.id, "elevenlabs-thunder-01");
  assert.equal(readJson(root, "library/ambient/elevenlabs-thunder-01.json").kind, "oneshot");
  assert.deepEqual(plan.cost.meteredUsd, { stability: 0.2, fal: 0.036 });
  assert.equal(run.json.costUsd, 0.036);
  const check = validate(root);
  assert.equal(check.code, 0, check.stderr);
});

test("a rerun keeps generated sounds already in the Sound library and makes no fal request", async () => {
  const root = generatedTree();
  assert.equal((await runScript(script, [fixtureScene], { cwd: root, env: server.env })).code, 0);
  const before = server.requests.length;
  const rerun = await runScript(script, [fixtureScene], { cwd: root, env: server.env });
  assert.equal(rerun.code, 0, rerun.stderr);
  assert.deepEqual(rerun.json.entries.map((e: any) => [e.file, e.action]), [["rain.ogg", "kept"], ["room.ogg", "copied"], ["thunder.ogg", "copied"]]);
  assert.deepEqual(server.requests.slice(before).filter((r) => r.service === "fal"), []);
  assert.deepEqual(readJson(root, fixtureScene).cost.meteredUsd, { stability: 0.2, fal: 0.028 });
});

test("a failed generation exits non-zero with the HTTP status and leaves that entry unresolved", async () => {
  const root = generatedTree();
  editJson(root, fixtureScene, (plan) => {
    plan.soundtrack.ambient[0].source.brief = FAILING_BRIEF;
  });
  const run = await runScript(script, [fixtureScene], { cwd: root, env: server.env });
  assert.equal(run.code, 1);
  assert.match(run.json.error, /^fal request fixture-request-\d+ result: HTTP 500$/);
  const plan = readJson(root, fixtureScene);
  assert.equal(plan.soundtrack.ambient[0].source.id, undefined);
  assert.deepEqual(plan.cost.meteredUsd, { stability: 0.2 });
  assert.equal(existsSync(join(root, sceneDir, "rain.ogg")), false);
});

test("a paid generation that cannot be decoded still records an upper-bound metered cost and exits non-zero", async () => {
  const root = generatedTree();
  editJson(root, fixtureScene, (plan) => {
    plan.soundtrack.ambient[0].source.brief = UNDECODABLE_BRIEF;
  });
  const run = await runScript(script, [fixtureScene], { cwd: root, env: server.env });
  assert.equal(run.code, 1);
  assert.match(run.json.error, /^fal request fixture-request-\d+: cannot decode the returned audio: /);
  const plan = readJson(root, fixtureScene);
  assert.equal(plan.soundtrack.ambient[0].source.id, undefined);
  assert.deepEqual(plan.cost.meteredUsd, { stability: 0.2, fal: 0.044 });
  assert.equal(existsSync(join(root, sceneDir, "rain.ogg")), false);
});

test("a generated source naming a service other than elevenlabs-fal fails before any request", async () => {
  const root = generatedTree();
  editJson(root, fixtureScene, (plan) => { plan.soundtrack.ambient[0].source.service = "stable-audio-3"; });
  const before = server.requests.length;
  const run = await runScript(script, [fixtureScene], { cwd: root, env: server.env });
  assert.equal(run.code, 1);
  assert.equal(run.json.error, `${fixtureScene}: soundtrack.ambient[0].source.service: stable-audio-3 is not supported; use elevenlabs-fal`);
  assert.equal(server.requests.length, before);
});
