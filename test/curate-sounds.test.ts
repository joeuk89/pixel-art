import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
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
const thunder = { id: "freesound-thunder-distant-195522", sourceId: 195522, kind: "oneshot", distance: ["far"], subject: "distant thunder", tags: ["thunder"], method: "cut", fadeSec: 0.5 };

function tree(spec: unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), "pixel-art-curate-"));
  writeJson(root, "spec.json", spec);
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
  const oneshot = levels(join(root, `library/ambient/${thunder.id}.ogg`), readJson(root, `library/ambient/${thunder.id}.json`).channels);
  assert.ok(Math.abs(oneshot.peakDb - -6) < 0.5, `one-shot peak ${oneshot.peakDb} dBFS`);
});
