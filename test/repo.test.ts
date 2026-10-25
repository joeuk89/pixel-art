import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ambientRecordCount, repo, validate } from "./helpers.ts";

test("validate exits 0 over the repo's library and prints one JSON object", () => {
  const { code, report, stderr } = validate(repo, "library");
  assert.equal(code, 0, stderr);
  assert.equal(report.ok, true);
  assert.equal(stderr, "");
});

for (const name of ["cosy-night", "golden-hour"]) {
  test(`the ${name}-v2 Palette copies ${name}'s colours and carries a complete Ramp table that validates`, () => {
    const file = `library/palettes/${name}-v2.json`;
    const { code, report, stderr } = validate(repo, file);
    assert.equal(code, 0, stderr);
    assert.equal(report.checked.palettes, 1);
    const original = JSON.parse(readFileSync(join(repo, `library/palettes/${name}.json`), "utf8"));
    const copy = JSON.parse(readFileSync(join(repo, file), "utf8"));
    assert.equal(copy.name, `${name}-v2`);
    assert.deepEqual(copy.colours, original.colours);
    assert.equal(copy.ramps.length, copy.colours.length);
    for (const ramp of copy.ramps) assert.deepEqual(Object.keys(ramp).sort(), ["cool", "dark", "warm"]);
  });
}

test("no v1 canvas or Backdrop size survives in schema, pipeline, viewer or tests", () => {
  // Built from parts so the pattern does not match this file.
  const pattern = `(^|[^0-9A-Za-z_#])(${2 * 96}|${2 * 60})([^0-9A-Za-z_]|$)|${2 ** 7}x${2 ** 6}|${"BACKDROP"}_`;
  const args = ["grep", "-nIE", "--untracked", "-e", pattern, "--and", "--not", "-e", "DEFAULT_STAGE_F = ", "--and", "--not", "-e", "\"vanishingPoint\": { \"x\": 192,", "--", "schema", "pipeline", "viewer", "test"];
  const run = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(run.stdout, "", run.stdout);
});

test("the cosy-night Palette validates and index 0 is the background colour", () => {
  const { code, report } = validate(repo, "library/palettes/cosy-night.json");
  assert.equal(code, 0);
  assert.equal(report.checked.palettes, 1);
  const palette = JSON.parse(readFileSync(join(repo, "library/palettes/cosy-night.json"), "utf8"));
  assert.equal(palette.colours.length, 16);
  assert.equal(palette.colours[0], "#120e1a");
});

test("every Ambient loop record validates", () => {
  const { code, report } = validate(repo, "library/ambient");
  assert.equal(code, 0);
  assert.equal(report.checked.ambient, ambientRecordCount);
  assert.deepEqual(report.errors, []);
});

test("esbuild bundles the Viewer entry with the shared schema", () => {
  const out = join(mkdtempSync(join(tmpdir(), "pixel-art-bundle-")), "viewer.js");
  const esbuild = join(repo, "node_modules/.bin/esbuild");
  const run = spawnSync(esbuild, [join(repo, "viewer/main.ts"), "--bundle", `--outfile=${out}`], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(readFileSync(out, "utf8"), /a Scene needs at least one Variant/);
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

test("ADR 0004 records lighting as a Ramp pass in the Viewer with the Halo as the only exception", () => {
  const file = join(repo, "docs/adr/0004-lighting-is-a-ramp-pass-in-the-viewer.md");
  assert.ok(existsSync(file), "ADR 0004 exists");
  const text = readFileSync(file, "utf8");
  assert.match(text, /^# .*Ramp pass/m);
  assert.match(text, /Halo/);
  assert.match(text, /## Considered options/);
});

test("ADR 0004 and the lighting step name the Halo without its avoided synonyms", () => {
  for (const path of ["docs/adr/0004-lighting-is-a-ramp-pass-in-the-viewer.md", ".claude/skills/director/lighting.md"]) {
    const text = readFileSync(join(repo, path), "utf8");
    assert.doesNotMatch(text, /\b(bloom|aura)\b/i, `${path} calls the Halo a bloom or aura`);
  }
});

test("ADR 0004 agrees with the briefs: they name a light direction and ban painted-in light", () => {
  const text = readFileSync(join(repo, "docs/adr/0004-lighting-is-a-ramp-pass-in-the-viewer.md"), "utf8");
  assert.doesNotMatch(text, /leave out light words/i);
  assert.match(text, /direction its light comes from/i);
});
