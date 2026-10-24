import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { editJson, fixtureScene, makeTree, runScript } from "./helpers.ts";

function git(root: string, ...args: string[]): void {
  const run = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
}

function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

const now = new Date();
const thisMonth = monthOf(now);
const lastMonth = monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)));

function addScene(root: string, id: string, month: string, pixellabGenerations: number, meteredUsd: Record<string, number>): void {
  const dir = `scenes/${id}`;
  cpSync(join(root, "scenes/fixture-rainy-desk-a1b2"), join(root, dir), { recursive: true });
  editJson(root, `${dir}/scene.json`, (plan) => {
    plan.id = id;
    plan.createdAt = `${month}-02T10:00:00Z`;
    plan.cost = { pixellabGenerations, meteredUsd, attemptsAbandoned: 0, approvedOverage: null };
  });
}

function ledgerTree(): string {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.createdAt = `${thisMonth}-01T00:00:00Z`; });
  addScene(root, "second-scene-b2c3", thisMonth, 10, { stability: 0.3, "fal-ai": 0.05 });
  addScene(root, "old-scene-c3d4", lastMonth, 100, { stability: 0.9 });
  git(root, "init", "-q");
  git(root, "add", "scenes");
  git(root, "commit", "-q", "-m", "scenes");
  addScene(root, "staged-scene-d4e5", thisMonth, 50, { stability: 0.5 });
  git(root, "add", "scenes/staged-scene-d4e5");
  return root;
}

test("ledger sums the committed Scenes of the current month against both ceilings", () => {
  const { code, out, stderr } = runScript(ledgerTree(), "ledger");
  assert.equal(code, 0, stderr);
  assert.equal(out.ok, true);
  assert.equal(out.month, thisMonth);
  assert.deepEqual(out.scenes.map((s: any) => s.id), ["fixture-rainy-desk-a1b2", "second-scene-b2c3"]);
  assert.deepEqual(out.pixellabGenerations, { used: 14, ceiling: 2000, remaining: 1986 });
  assert.deepEqual(out.metered, { usd: 0.55, byService: { stability: 0.5, "fal-ai": 0.05 }, ceilingGbp: 50, usdPerGbp: 1.3, ceilingUsd: 65, remainingUsd: 64.45 });
  assert.equal(out.overCeiling, false);
});

test("ledger --month sums another month", () => {
  const { code, out } = runScript(ledgerTree(), "ledger", "--month", lastMonth);
  assert.equal(code, 0);
  assert.deepEqual(out.scenes.map((s: any) => s.id), ["old-scene-c3d4"]);
  assert.equal(out.pixellabGenerations.used, 100);
  assert.equal(out.metered.usd, 0.9);
});

test("ledger reports when a ceiling is passed", () => {
  const root = ledgerTree();
  addScene(root, "big-scene-e5f6", thisMonth, 1990, { stability: 0.1 });
  git(root, "add", "scenes");
  git(root, "commit", "-q", "-m", "big");
  const { out } = runScript(root, "ledger");
  assert.deepEqual(out.pixellabGenerations, { used: 2054, ceiling: 2000, remaining: -54 });
  assert.equal(out.overCeiling, true);
});

for (const [what, args, setup, message] of [
  ["the month is malformed", ["--month", "October"], ledgerTree, /--month must be YYYY-MM/],
  ["the folder is not a git repository", [], makeTree, /git/],
] as const) {
  test(`ledger exits non-zero with one JSON object when ${what}`, () => {
    const { code, out } = runScript(setup(), "ledger", ...args);
    assert.equal(code, 1);
    assert.equal(out.ok, false);
    assert.match(out.error, message);
  });
}
