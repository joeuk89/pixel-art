import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repo } from "./helpers.ts";
import { runScript, startFixtureServer, type FixtureServer } from "./fixture-server.ts";

const script = join(repo, "pipeline/check-audio-keys.ts");
let server: FixtureServer;
before(async () => { server = await startFixtureServer(); });
after(() => server.close());

const cwd = () => mkdtempSync(join(tmpdir(), "pixel-art-keys-"));

test("check-audio-keys passes every audio service against the fixture server and prints one JSON object", async () => {
  const run = await runScript(script, [], { cwd: cwd(), env: server.env });
  assert.equal(run.code, 0, run.stdout + run.stderr);
  assert.equal(run.json.ok, true);
  assert.deepEqual(run.json.checks.map((c: any) => [c.service, c.status]), [
    ["stability", "pass"], ["gemini", "pass"], ["fal", "pass"], ["freesound", "pass"],
  ]);
  assert.match(run.json.checks[0].detail, /balance 12\.5 credits/);
  assert.match(run.json.checks[1].detail, /lyria-3\.5/);
});

test("a missing key is reported as skipped and the run exits 1", async () => {
  const run = await runScript(script, [], { cwd: cwd(), env: { ...server.env, FAL_KEY: undefined } });
  assert.equal(run.code, 1);
  const fal = run.json.checks.find((c: any) => c.service === "fal");
  assert.equal(fal.status, "skip");
  assert.match(fal.detail, /FAL_KEY not set/);
});

test("a rejected key is reported as failed with the HTTP status", async () => {
  const run = await runScript(script, [], { cwd: cwd(), env: { ...server.env, STABILITY_API_KEY: "wrong" } });
  assert.equal(run.code, 1);
  assert.deepEqual(run.json.checks[0], { service: "stability", status: "fail", detail: "stability balance: HTTP 401" });
});
