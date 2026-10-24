import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { editJson, fixtureScene, makeTree, readJson, repo, validate } from "./helpers.ts";
import { runScript, startFixtureServer, type FixtureServer } from "./fixture-server.ts";

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
