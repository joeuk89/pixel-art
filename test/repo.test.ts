import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repo, validate } from "./helpers.ts";

test("validate exits 0 over the repo and prints one JSON object", () => {
  const { code, report, stderr } = validate(repo);
  assert.equal(code, 0, stderr);
  assert.equal(report.ok, true);
  assert.equal(stderr, "");
});

test("the cosy-night Palette validates and index 0 is the background colour", () => {
  const { code, report } = validate(repo, "library/palettes/cosy-night.json");
  assert.equal(code, 0);
  assert.equal(report.checked.palettes, 1);
  const palette = JSON.parse(readFileSync(join(repo, "library/palettes/cosy-night.json"), "utf8"));
  assert.equal(palette.colours.length, 16);
  assert.equal(palette.colours[0], "#120e1a");
});

test("all thirteen Ambient loop records validate", () => {
  const { code, report } = validate(repo, "library/ambient");
  assert.equal(code, 0);
  assert.equal(report.checked.ambient, 13);
  assert.deepEqual(report.errors, []);
});

test("esbuild bundles the Viewer entry with the shared schema", () => {
  const out = join(mkdtempSync(join(tmpdir(), "pixel-art-bundle-")), "viewer.js");
  const esbuild = join(repo, "node_modules/.bin/esbuild");
  const run = spawnSync(esbuild, [join(repo, "viewer/main.ts"), "--bundle", `--outfile=${out}`], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(readFileSync(out, "utf8"), /a layer has either fill or placements, never both/);
});

test("git tracks the Element library and scenes folders", () => {
  for (const dir of ["library/elements", "scenes"]) {
    const run = spawnSync("git", ["ls-files", "--error-unmatch", dir], { cwd: repo, encoding: "utf8" });
    assert.equal(run.status, 0, `${dir} is not tracked`);
  }
});

test("the curation spec lists the thirteen curated sounds and the ten starter loops, once each", () => {
  const spec = JSON.parse(readFileSync(join(repo, "pipeline/curate-sounds.spec.json"), "utf8"));
  const ids = spec.map((e: any) => e.id);
  assert.equal(new Set(ids).size, 23);
  const starters = [242889, 238431, 595717, 444921, 813328, 650574, 223093, 844261, 723913, 167304];
  for (const sourceId of starters) {
    const entry = spec.find((e: any) => e.sourceId === sourceId);
    assert.ok(entry, `starter ${sourceId} missing`);
    assert.equal(entry.kind, "loop");
    assert.match(entry.id, new RegExp(`^freesound-[a-z]+(-[a-z]+)*-${sourceId}$`));
  }
});

test("the old scripts folder is gone", () => {
  assert.equal(existsSync(join(repo, "scripts")), false);
});
