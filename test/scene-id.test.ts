import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fixtures, makeTree, runScript, validate, writeJson } from "./helpers.ts";

test("scene-id slugs the words and adds a four-character random suffix", () => {
  const { code, out, stderr } = runScript(makeTree(), "scene-id", "Rainy", "desk", "at", "NIGHT");
  assert.equal(code, 0, stderr);
  assert.equal(out.ok, true);
  assert.match(out.id, /^rainy-desk-at-night-[a-z0-9]{4}$/);
  assert.ok(Number.isInteger(out.seed) && out.seed >= 0);
  assert.ok(!Number.isNaN(Date.parse(out.createdAt)));
});

test("scene-id folds accents and drops punctuation", () => {
  const { out } = runScript(makeTree(), "scene-id", "a cosy café, by the sea!");
  assert.match(out.id, /^a-cosy-cafe-by-the-sea-[a-z0-9]{4}$/);
});

test("scene-id keeps at most six words", () => {
  const { out } = runScript(makeTree(), "scene-id", "one two three four five six seven eight");
  assert.match(out.id, /^one-two-three-four-five-six-[a-z0-9]{4}$/);
});

test("scene-id gives a different suffix on each run", () => {
  const root = makeTree();
  const ids = new Set(Array.from({ length: 5 }, () => runScript(root, "scene-id", "garden").out.id));
  assert.equal(ids.size, 5);
});

test("scene-id never returns the id of an existing Scene folder", () => {
  const root = makeTree();
  const { out } = runScript(root, "scene-id", "fixture", "rainy", "desk");
  assert.notEqual(out.id, "fixture-rainy-desk-a1b2");
  mkdirSync(join(root, "scenes", out.id));
  const again = runScript(root, "scene-id", "fixture", "rainy", "desk");
  assert.notEqual(again.out.id, out.id);
});

for (const args of [[], ["!!!"]]) {
  test(`scene-id exits non-zero with a usage error for ${JSON.stringify(args)}`, () => {
    const { code, out } = runScript(makeTree(), "scene-id", ...args);
    assert.equal(code, 1);
    assert.equal(out.ok, false);
    assert.match(out.error, /usage: scene-id <words\.\.\.>/);
  });
}

test("a draft plan under a scene-id id with unresolved generate blocks passes validate as draft", () => {
  const root = makeTree();
  const { out } = runScript(root, "scene-id", "rainy", "desk", "night");
  const plan = JSON.parse(readFileSync(join(fixtures, "spec-example-scene.json"), "utf8"));
  writeJson(root, `scenes/${out.id}/scene.json`, { ...plan, id: out.id, seed: out.seed, createdAt: out.createdAt, styleAnchor: null, status: "draft" });
  const { code, report, stderr } = validate(root, `scenes/${out.id}`);
  assert.equal(code, 0, stderr);
  assert.equal(report.scenes.length, 1);
  assert.equal(report.scenes[0].id, out.id);
  assert.equal(report.scenes[0].status, "draft");
  assert.ok(report.scenes[0].pending.some((p: any) => p.path.endsWith(".generate")));
});
