import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fixtureScene, makeTree, readJson, repo, runScript, writeJson } from "./helpers.ts";

const id = "fixture-rainy-desk-a1b2";
const servers: ChildProcess[] = [];

after(() => {
  for (const server of servers) server.kill();
});

const git = (root: string, ...args: string[]) => {
  const run = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
};

// A committed repo with a stubbed, rendered Scene, so preview's hard checks can pass or fail on the test stub alone.
export function tunerTree(tests: "pass" | "fail" = "pass"): string {
  const root = makeTree();
  writeJson(root, "package.json", { private: true, scripts: { test: `node -e "process.exit(${tests === "pass" ? 0 : 1})"` } });
  assert.equal(runScript(root, "poster", fixtureScene).code, 0);
  assert.equal(runScript(root, "stub", fixtureScene).code, 0);
  git(root, "init", "-q");
  git(root, "add", ".");
  git(root, "commit", "-qm", "tree");
  return root;
}

export async function startTuner(root: string): Promise<string> {
  const server = spawn(process.execPath, [join(repo, "pipeline/tune.ts"), fixtureScene, "--port", "0", "--no-open"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  servers.push(server);
  let stderr = "";
  server.stderr!.on("data", (chunk) => (stderr += chunk));
  const lines = createInterface({ input: server.stdout! });
  return new Promise((resolve, reject) => {
    lines.once("line", (line) => {
      const started = JSON.parse(line);
      if (started.ok) resolve(started.url);
      else reject(new Error(started.error));
    });
    server.once("exit", (code) => reject(new Error(`tune exited with ${code}: ${stderr}`)));
  });
}

async function save(url: string, body: unknown): Promise<{ status: number; out: any }> {
  const response = await fetch(new URL("save", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, out: await response.json() };
}

const tuningOf = (plan: any) => ({
  dither: plan.dither,
  variants: plan.variants.map((v: any) => ({ id: v.id, ambient: v.ambient, lights: v.lights, emissiveOff: v.emissiveOff })),
});

const between = (text: string, from: string, to: string) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `no text between ${from} and ${to}`);
  return text.slice(start, end);
};

test("a lighting-only Save replaces the Variant lighting fields and dither and leaves every other byte of the plan as it was", async () => {
  const root = tunerTree();
  const before = readFileSync(join(root, fixtureScene), "utf8");
  const url = await startTuner(root);
  const tuning = tuningOf(readJson(root, fixtureScene));
  tuning.dither = true;
  tuning.variants[0].ambient = { level: -2, layers: { sky: -1 } };
  tuning.variants[0].lights[0].strength = 2;
  tuning.variants[0].emissiveOff = ["skyline"];

  const { status, out } = await save(url, tuning);
  assert.equal(status, 200, JSON.stringify(out));
  const after = readFileSync(join(root, fixtureScene), "utf8");
  const plan = JSON.parse(after);
  assert.equal(plan.dither, true);
  assert.deepEqual(plan.variants[0].ambient, { level: -2, layers: { sky: -1 } });
  assert.equal(plan.variants[0].lights[0].strength, 2);
  assert.deepEqual(plan.variants[0].lights.slice(1), JSON.parse(before).variants[0].lights.slice(1));
  assert.deepEqual(plan.variants[0].emissiveOff, ["skyline"]);

  assert.equal(after.slice(0, after.indexOf('"dither"')), before.slice(0, before.indexOf('"dither"')));
  assert.equal(between(after, '"styleAnchor"', '"ambient"'), between(before, '"styleAnchor"', '"ambient"'));
  assert.equal(after.slice(after.indexOf('{ "id": "clear-night"')), before.slice(before.indexOf('{ "id": "clear-night"')));
});
