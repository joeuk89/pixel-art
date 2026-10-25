import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fixtureScene, makeTree, repo, runScript, writeJson } from "./helpers.ts";

export function git(root: string, ...args: string[]): string {
  const run = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

// A committed repo with a stubbed, rendered Scene, so preview's hard checks pass or fail on the test stub alone.
export function tunerTree(tests: "pass" | "fail" = "pass", prepare?: (root: string) => void): string {
  const root = makeTree();
  prepare?.(root);
  writeJson(root, "package.json", { private: true, scripts: { test: `node -e "process.exit(${tests === "pass" ? 0 : 1})"` } });
  assert.equal(runScript(root, "poster", fixtureScene).code, 0);
  assert.equal(runScript(root, "stub", fixtureScene).code, 0);
  git(root, "init", "-q");
  git(root, "add", ".");
  git(root, "commit", "-qm", "tree");
  return root;
}

const running: ChildProcess[] = [];

export function stopTuners(): void {
  for (const server of running.splice(0)) server.kill();
}

export async function startTuner(root: string, plan = fixtureScene): Promise<string> {
  const server = spawn(process.execPath, [join(repo, "pipeline/tune.ts"), plan, "--port", "0", "--no-open"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  running.push(server);
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
