import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import ffmpeg from "ffmpeg-static";
import { editJson, fixtureScene, makeTree, readJson, repo, validate } from "./helpers.ts";
import { runScript, startFixtureServer, type FixtureRequest, type FixtureServer } from "./fixture-server.ts";

const script = join(repo, "pipeline/music.ts");
const sceneDir = "scenes/fixture-rainy-desk-a1b2";
const MP3_FRAME = 1152;
let server: FixtureServer;
before(async () => { server = await startFixtureServer(); });
after(() => server.close());

function draftTree(): string {
  const root = makeTree();
  rmSync(join(root, sceneDir, "music.mp3"));
  editJson(root, fixtureScene, (plan) => {
    plan.status = "draft";
    plan.soundtrack.music = { brief: "slow piano, rain on a window, warm and sparse", service: "stable-audio-3", gain: 0.6 };
  });
  return root;
}

const env = () => ({ ...server.env, STABILITY_POLL_MS: "10" });
const since = (n: number) => server.requests.slice(n);

async function form(req: FixtureRequest): Promise<FormData> {
  return new Response(req.body, { headers: { "content-type": String(req.headers["content-type"]) } }).formData();
}

function decode(mp3: string): Float32Array[] {
  const raw = execFileSync(ffmpeg as unknown as string, ["-loglevel", "error", "-i", mp3, "-f", "f32le", "-ac", "2", "-"], { maxBuffer: 1 << 28 });
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const n = all.length / 2, left = new Float32Array(n), right = new Float32Array(n);
  for (let i = 0; i < n; i++) { left[i] = all[2 * i]; right[i] = all[2 * i + 1]; }
  return [left, right];
}

test("music generates from Stable Audio, writes music.mp3 and records loop points, seam and cost in the plan", async () => {
  const root = draftTree();
  const mark = server.requests.length;
  const run = await runScript(script, [fixtureScene], { cwd: root, env: env() });
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.json.ok, true);
  assert.equal(run.json.file, `${sceneDir}/music.mp3`);
  assert.ok(existsSync(join(root, sceneDir, "music.mp3")));

  const music = readJson(root, fixtureScene).soundtrack.music;
  assert.equal(music.file, "music.mp3");
  assert.equal(music.loopStart, 0);
  assert.ok(music.loopEnd >= 105 && music.loopEnd <= 115, `loopEnd ${music.loopEnd}`);
  assert.equal(music.service, "stable-audio-3");
  assert.equal(music.brief, "slow piano, rain on a window, warm and sparse");
  assert.ok(music.seam.seamJump <= music.seam.maxInnerJump, JSON.stringify(music.seam));
  assert.equal(run.json.loopEnd, music.loopEnd);
  assert.deepEqual(run.json.seam, music.seam);
  assert.deepEqual(readJson(root, fixtureScene).cost.meteredUsd, { stability: 0.28 });

  const calls = since(mark);
  assert.deepEqual(calls.map((r) => r.service), calls.map(() => "stability"));
  const [submit, ...polls] = calls;
  assert.equal(submit.method, "POST");
  assert.equal(submit.path, "/v2beta/audio/stable-audio/text-to-audio");
  assert.equal(submit.headers.accept, "application/json");
  const fields = await form(submit);
  assert.match(String(fields.get("prompt")), /slow piano, rain on a window, warm and sparse/);
  assert.equal(fields.get("duration"), "135");
  assert.equal(fields.get("output_format"), "wav");
  assert.ok(polls.length >= 2, "polled past the 202");
  for (const poll of polls) {
    assert.equal(poll.method, "GET");
    assert.match(poll.path, /^\/v2beta\/audio\/results\/[\w-]+$/);
    assert.equal(poll.headers.accept, "audio/*");
  }

  const check = validate(root, sceneDir);
  assert.equal(check.code, 0, JSON.stringify(check.report));
  assert.equal(check.report.scenes[0].status, "resolved", JSON.stringify(check.report.scenes[0]));
});

test("the encoded MP3 decodes to loopEnd within one MP3 frame and wraps without a click", async () => {
  const root = draftTree();
  const run = await runScript(script, [fixtureScene], { cwd: root, env: env() });
  assert.equal(run.code, 0, run.stderr);
  const { loopEnd } = readJson(root, fixtureScene).soundtrack.music;
  const [left] = decode(join(root, sceneDir, "music.mp3"));
  assert.ok(Math.abs(left.length - loopEnd * 48000) <= MP3_FRAME, `decoded ${left.length} samples, loopEnd ${loopEnd} s is ${loopEnd * 48000}`);
  let maxInner = 0;
  for (let i = 1; i < left.length; i++) maxInner = Math.max(maxInner, Math.abs(left[i] - left[i - 1]));
  assert.ok(Math.abs(left[0] - left[left.length - 1]) <= maxInner);
});

test("validate keeps a plan draft while its music has no measured seam", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => {
    plan.status = "draft";
    delete plan.soundtrack.music.seam;
  });
  const check = validate(root, sceneDir);
  assert.equal(check.code, 0, JSON.stringify(check.report));
  assert.equal(check.report.scenes[0].status, "draft");
  assert.ok(check.report.scenes[0].pending.some((p: any) => p.path === "soundtrack.music.seam"), JSON.stringify(check.report.scenes[0].pending));
});
