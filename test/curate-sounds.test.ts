import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import ffmpeg from "ffmpeg-static";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repo, readJson, validate, writeJson } from "./helpers.ts";
import { runScript, startFixtureServer, type FixtureServer } from "./fixture-server.ts";

const script = join(repo, "pipeline/curate-sounds.ts");
let server: FixtureServer;
before(async () => { server = await startFixtureServer(); });
after(() => server.close());

const roomTone = { id: "freesound-room-tone-641306", sourceId: 641306, kind: "loop", distance: ["mid"], subject: "room tone", tags: ["room tone", "bed"], method: "crossfade", targetSec: 6, fadeSec: 1 };
const vent = { id: "freesound-vent-hum-753540", sourceId: 753540, kind: "loop", distance: ["mid"], subject: "vent hum", tags: ["vent", "hum"], method: "whole" };
const crackle = { id: "freesound-fire-crackle-650574", sourceId: 650574, kind: "loop", distance: ["near"], subject: "fire crackle", tags: ["fire"], method: "whole" };
const thunder = { id: "freesound-thunder-distant-195522", sourceId: 195522, kind: "oneshot", distance: ["far"], subject: "distant thunder", tags: ["thunder"], method: "cut", fadeSec: 0.5 };

function tree(spec: unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), "pixel-art-curate-"));
  writeJson(root, "spec.json", spec);
  mkdirSync(join(root, "library/ambient"), { recursive: true });
  return root;
}

test("curate-sounds writes an OGG and a record for each entry and prints one JSON object", async () => {
  const root = tree([roomTone, vent, thunder]);
  const run = await runScript(script, ["spec.json"], { cwd: root, env: server.env });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.json.ok, true);
  assert.deepEqual(run.json.written.map((w: any) => w.id), [roomTone.id, vent.id, thunder.id]);
  assert.deepEqual(run.json.skipped, []);
  for (const { id } of [roomTone, vent, thunder]) {
    assert.ok(existsSync(join(root, `library/ambient/${id}.ogg`)), `${id}.ogg missing`);
    const record = readJson(root, `library/ambient/${id}.json`);
    assert.equal(record.id, id);
    assert.equal(record.file, `${id}.ogg`);
  }
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

test("curated records pass validate, carry their licence chain and are normalised by kind", async () => {
  const root = tree([roomTone, thunder]);
  const run = await runScript(script, ["spec.json"], { cwd: root, env: server.env });
  assert.equal(run.code, 0, run.stderr);
  const check = validate(root, "library/ambient");
  assert.equal(check.code, 0, check.stderr);
  assert.equal(check.report.checked.ambient, 2);

  const record = readJson(root, `library/ambient/${roomTone.id}.json`);
  assert.equal(record.licence, "CC0-1.0");
  assert.equal(record.licenceUrl, "http://creativecommons.org/publicdomain/zero/1.0/");
  assert.equal(record.author, "aleclubin");
  assert.equal(record.attribution, "\"House Room Tone\" by aleclubin on Freesound, CC0");
  assert.equal(record.sourceUrl, "https://freesound.org/people/aleclubin/sounds/641306/");

  const loop = levels(join(root, `library/ambient/${roomTone.id}.ogg`), record.channels);
  assert.ok(Math.abs(loop.rmsDb - -20) < 0.5, `loop RMS ${loop.rmsDb} dBFS`);
  assert.equal(record.processing.target, "-20 dBFS RMS");
  assert.equal(record.processing.limitedBy, null);
  assert.ok(Math.abs(record.processing.rmsDbfs - loop.rmsDb) < 0.5, `record says ${record.processing.rmsDbfs}, file is ${loop.rmsDb}`);
  const oneshot = levels(join(root, `library/ambient/${thunder.id}.ogg`), readJson(root, `library/ambient/${thunder.id}.json`).channels);
  assert.ok(Math.abs(oneshot.peakDb - -6) < 0.5, `one-shot peak ${oneshot.peakDb} dBFS`);
});

test("a loop with sharp peaks records the level it reached and that the peak ceiling limited it", async () => {
  const root = tree([crackle]);
  const run = await runScript(script, ["spec.json"], { cwd: root, env: server.env });
  assert.equal(run.code, 0, run.stderr);
  const record = readJson(root, `library/ambient/${crackle.id}.json`);
  const file = levels(join(root, `library/ambient/${crackle.id}.ogg`), record.channels);
  assert.ok(file.rmsDb < -25, `fixture should stay well under -20 dBFS RMS, got ${file.rmsDb}`);
  assert.equal(record.processing.target, "-20 dBFS RMS");
  assert.equal(record.processing.limitedBy, "peak");
  assert.ok(Math.abs(record.processing.rmsDbfs - file.rmsDb) < 0.5, `record says ${record.processing.rmsDbfs}, file is ${file.rmsDb}`);
  assert.ok(Math.abs(record.processing.peakDbfs - file.peakDb) < 0.5, `record says peak ${record.processing.peakDbfs}, file is ${file.peakDb}`);
  assert.equal("normalisedTo" in record.processing, false);
});

test("a source that is not CC0 fails and writes nothing for that entry", async () => {
  const entry = { ...vent, id: "freesound-rain-attribution-100001", sourceId: 100001 };
  const root = tree([entry]);
  const run = await runScript(script, ["spec.json"], { cwd: root, env: server.env });
  assert.equal(run.code, 1);
  assert.equal(run.json.ok, false);
  assert.match(run.json.error, /freesound-rain-attribution-100001: licence is https:\/\/creativecommons.org\/licenses\/by\/4.0\/, not CC0/);
  assert.equal(existsSync(join(root, `library/ambient/${entry.id}.ogg`)), false);
  assert.equal(existsSync(join(root, `library/ambient/${entry.id}.json`)), false);
});

test("an unknown Freesound id fails with the HTTP status and keeps entries already written", async () => {
  const root = tree([vent, { ...vent, id: "freesound-gone-999999", sourceId: 999999 }]);
  const run = await runScript(script, ["spec.json"], { cwd: root, env: server.env });
  assert.equal(run.code, 1);
  assert.equal(run.json.error, "freesound 999999: HTTP 404");
  assert.deepEqual(run.json.written.map((w: any) => w.id), [vent.id]);
});

test("requests go to the base URL from the environment and carry the key from the environment", async () => {
  const root = tree([vent]);
  const before = server.requests.length;
  const run = await runScript(script, ["spec.json"], { cwd: root, env: server.env });
  assert.equal(run.code, 0, run.stderr);
  const sent = server.requests.slice(before);
  assert.deepEqual(sent.map((r) => `${r.service} ${r.path}`), ["freesound /apiv2/sounds/753540/", "freesound /previews/753540/bed.ogg"]);
  assert.equal(sent[0].query.get("token"), "fixture-freesound-key");
});

test("a missing base URL fails, naming the variable, before any request", async () => {
  const root = tree([vent]);
  const before = server.requests.length;
  const run = await runScript(script, ["spec.json"], { cwd: root, env: { ...server.env, FREESOUND_BASE_URL: undefined } });
  assert.equal(run.code, 1);
  assert.match(run.json.error, /FREESOUND_BASE_URL not set/);
  assert.equal(server.requests.length, before);
});

test("an invalid spec entry fails with the entry and field named", async () => {
  const root = tree([{ ...vent, method: "stretch" }]);
  const run = await runScript(script, ["spec.json"], { cwd: root, env: server.env });
  assert.equal(run.code, 1);
  assert.match(run.json.error, /\[0\]\.method/);
});

test("an entry already in the Sound library is skipped without a request, unless --force", async () => {
  const root = tree([vent]);
  assert.equal((await runScript(script, ["spec.json"], { cwd: root, env: server.env })).code, 0);
  writeJson(root, "spec.json", [vent, thunder]);

  const before = server.requests.length;
  const rerun = await runScript(script, ["spec.json"], { cwd: root, env: server.env });
  assert.equal(rerun.code, 0, rerun.stderr);
  assert.deepEqual(rerun.json.skipped, [vent.id]);
  assert.deepEqual(rerun.json.written.map((w: any) => w.id), [thunder.id]);
  assert.ok(server.requests.slice(before).every((r) => !r.path.includes("753540")));

  const forced = await runScript(script, ["spec.json", "--force"], { cwd: root, env: server.env });
  assert.equal(forced.code, 0, forced.stderr);
  assert.deepEqual(forced.json.skipped, []);
  assert.deepEqual(forced.json.written.map((w: any) => w.id), [vent.id, thunder.id]);
});

test("the repo curation spec parses, and a library holding every entry needs no requests", async () => {
  const spec = readJson(repo, "pipeline/curate-sounds.spec.json");
  const root = tree(spec);
  for (const { id } of spec) {
    writeFileSync(join(root, `library/ambient/${id}.ogg`), "");
    writeFileSync(join(root, `library/ambient/${id}.json`), "{}");
  }
  const before = server.requests.length;
  const run = await runScript(script, ["spec.json"], { cwd: root, env: server.env });
  assert.equal(run.code, 0, run.stdout);
  assert.equal(run.json.skipped.length, 23);
  assert.equal(server.requests.length, before);
});
