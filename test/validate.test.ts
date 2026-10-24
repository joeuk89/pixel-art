import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureScene, makeTree, validate } from "./helpers.ts";

test("a resolved fixture Scene validates and is reported resolved", () => {
  const { code, report } = validate(makeTree());
  assert.equal(code, 0);
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.checked, { scenes: 1, elements: 3, palettes: 1, ambient: 13 });
  assert.deepEqual(report.scenes, [
    { id: "fixture-rainy-desk-a1b2", file: fixtureScene, declared: "resolved", status: "resolved", pending: [] },
  ]);
});
