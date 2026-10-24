import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fixtureScene, fixtures, makeTree, readJson, repo, runScript, writeJson } from "./helpers.ts";

function treeWithCurtain(): string {
  const root = makeTree();
  const window = readJson(root, "library/elements/window-wood-transparent-panes-01.json");
  writeJson(root, "library/elements/curtain-red-velvet-01.json", { ...window, id: "curtain-red-velvet-01", subject: "curtain" });
  return root;
}

const allSounds = readdirSync(join(repo, "library/ambient")).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)).sort();

test("orphans lists an unreferenced Element and every unreferenced loop and omits referenced ones", () => {
  const { code, out, stderr } = runScript(treeWithCurtain(), "orphans");
  assert.equal(code, 0, stderr);
  assert.equal(out.ok, true);
  assert.deepEqual(out.elements, [{ id: "curtain-red-velvet-01", kind: "prop", subject: "curtain" }]);
  const referenced = ["freesound-room-tone-641306", "freesound-thunder-distant-195522"];
  assert.deepEqual(out.ambient.map((a: any) => a.id), allSounds.filter((id) => !referenced.includes(id)));
  assert.deepEqual(out.ambient.find((a: any) => a.id === "freesound-owl-tawny-454842"), { id: "freesound-owl-tawny-454842", kind: "oneshot", subject: "owl" });
});

test("a draft Scene's Style anchor, ambient and One-shots count as references", () => {
  const root = treeWithCurtain();
  const example = JSON.parse(readFileSync(join(fixtures, "spec-example-scene.json"), "utf8"));
  example.styleAnchor = "curtain-red-velvet-01";
  example.soundtrack.ambient = [{ source: { kind: "curated", id: "freesound-vent-hum-753540" }, file: "vent.ogg", distance: "mid" }];
  example.soundtrack.oneshots = [{ source: { kind: "curated", id: "freesound-owl-tawny-454842" }, file: "owl.ogg", distance: "far", every: [60, 120] }];
  writeJson(root, "scenes/rainy-desk-night-k7f2/scene.json", example);
  const { code, out } = runScript(root, "orphans");
  assert.equal(code, 0);
  assert.deepEqual(out.elements, []);
  const ids = out.ambient.map((a: any) => a.id);
  for (const id of ["freesound-vent-hum-753540", "freesound-owl-tawny-454842", "freesound-room-tone-641306"]) assert.ok(!ids.includes(id), id);
});

test("orphans exits non-zero with one JSON object when given an argument", () => {
  const { code, out } = runScript(makeTree(), "orphans", "scenes");
  assert.equal(code, 1);
  assert.match(out.error, /usage: orphans/);
});

test("orphans exits non-zero with one JSON object when a Scene plan is broken", () => {
  const root = makeTree();
  writeJson(root, fixtureScene, { id: "fixture-rainy-desk-a1b2" });
  const { code, out } = runScript(root, "orphans");
  assert.equal(code, 1);
  assert.equal(out.ok, false);
  assert.match(out.error, /fixture-rainy-desk-a1b2\/scene\.json/);
});
