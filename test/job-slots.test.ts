import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repo } from "./helpers.ts";
import { takeSlot } from "../pipeline/lib/job-slots.ts";

const holder = join(repo, "test/fixtures/slot-holder.ts");

function holders(dir: string, log: string, rounds: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [holder, dir, log, String(rounds)], { stdio: ["ignore", "ignore", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

test("twenty processes taking and releasing slots in tight loops never hold more than 8 at once", { timeout: 120_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "slots-"));
  const dir = join(root, "jobs");
  const log = join(root, "log");
  writeFileSync(log, "");
  const codes = await Promise.all(Array.from({ length: 20 }, () => holders(dir, log, 100)));
  assert.deepEqual(codes, Array(20).fill(0));
  let held = 0;
  let peak = 0;
  for (const c of readFileSync(log, "utf8")) {
    held += c === "+" ? 1 : -1;
    peak = Math.max(peak, held);
  }
  assert.equal(held, 0);
  assert.ok(peak <= 8, `peak ${peak} slot holders`);
});

test("an empty slot file counts as held, not stale", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "slots-")), "jobs");
  mkdirSync(dir);
  writeFileSync(join(dir, "slot-0.lock"), "");
  const slot = await takeSlot(dir, 2, 1);
  assert.deepEqual(readdirSync(dir).sort(), ["slot-0.lock", "slot-1.lock"]);
  assert.equal(readFileSync(join(dir, "slot-0.lock"), "utf8"), "");
  slot.release();
  assert.deepEqual(readdirSync(dir), ["slot-0.lock"]);
});
