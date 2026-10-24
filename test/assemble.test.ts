import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { editJson, fixtureScene, makeTree, readJson, repo, runScript, writeJson } from "./helpers.ts";

const id = "fixture-rainy-desk-a1b2";

function siteTree(): string {
  const root = makeTree();
  cpSync(join(repo, "index.html"), join(root, "index.html"));
  writeFileSync(join(root, "viewer.js"), "console.log('viewer');\n");
  writeFileSync(join(root, "NOTICE.md"), "# Notice\n");
  assert.equal(runScript(root, "stub", fixtureScene).code, 0);
  for (const dir of ["prototypes/scene-engine", "docs/adr", "pipeline", "schema", "test", ".claude/skills/director"]) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "index.html"), "private");
  }
  writeFileSync(join(root, "library/.DS_Store"), "");
  return root;
}

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .sort();
}

test("assemble writes dist/ with only the Viewer HTML, the bundle, scenes, library, gallery.json and NOTICE.md", () => {
  const root = siteTree();
  const { code, out, stderr } = runScript(root, "assemble");
  assert.equal(code, 0, stderr);
  assert.equal(out.ok, true);
  assert.deepEqual(out.scenes, [id]);
  const dist = join(root, "dist");
  assert.deepEqual(readdirSync(dist).sort(), ["NOTICE.md", "gallery.json", "index.html", "library", "scenes", "viewer.js"]);
  assert.deepEqual(readdirSync(join(dist, "library")).sort(), ["ambient", "elements", "palettes"]);
});

test("published paths mirror the repo byte for byte and skip dotfiles", () => {
  const root = siteTree();
  assert.equal(runScript(root, "assemble").code, 0);
  const dist = join(root, "dist");
  const published = files(dist);
  assert.ok(published.includes(`scenes/${id}/scene.json`));
  assert.ok(published.includes(`scenes/${id}/index.html`));
  assert.ok(published.includes(`scenes/${id}/poster-og.png`));
  assert.ok(published.includes("library/elements/cat-tabby-asleep-01.strip.png"));
  assert.ok(published.includes("library/palettes/cosy-night.json"));
  assert.ok(published.some((p) => /^library\/ambient\/.+\.ogg$/.test(p)));
  assert.equal(published.filter((p) => p.split("/").some((part) => part.startsWith("."))).length, 0);
  for (const path of published) {
    assert.deepEqual(readFileSync(join(dist, path)), readFileSync(join(root, path)), path);
  }
});

test("a draft Scene is left out of dist/ and reported as skipped", () => {
  const root = siteTree();
  cpSync(join(root, "scenes", id), join(root, "scenes/unfinished-garden-c5d6"), { recursive: true });
  editJson(root, "scenes/unfinished-garden-c5d6/scene.json", (plan) => {
    plan.id = "unfinished-garden-c5d6";
    plan.status = "draft";
  });
  rmSync(join(root, "scenes/unfinished-garden-c5d6/poster.png"));
  const { code, out, stderr } = runScript(root, "assemble");
  assert.equal(code, 0, stderr);
  assert.deepEqual(out.scenes, [id]);
  assert.deepEqual(out.skipped, ["unfinished-garden-c5d6"]);
  assert.deepEqual(readdirSync(join(root, "dist/scenes")), [id]);
});

test("without a committed gallery.json assemble publishes an empty Gallery", () => {
  const root = siteTree();
  rmSync(join(root, "gallery.json"));
  assert.equal(runScript(root, "assemble").code, 0);
  assert.deepEqual(readJson(root, "dist/gallery.json"), []);
});

test("assembling again replaces the previous dist/", () => {
  const root = siteTree();
  assert.equal(runScript(root, "assemble").code, 0);
  writeFileSync(join(root, "dist/stale.html"), "old");
  assert.equal(runScript(root, "assemble").code, 0);
  assert.equal(existsSync(join(root, "dist/stale.html")), false);
});

for (const [name, breakTree, message] of [
  ["the bundle is missing", (root: string) => rmSync(join(root, "viewer.js")), /viewer\.js/],
  ["NOTICE.md is missing", (root: string) => rmSync(join(root, "NOTICE.md")), /NOTICE\.md/],
  [
    "gallery.json lists a Scene that is not resolved",
    (root: string) => writeJson(root, "gallery.json", [{ id: "deleted-scene-z9z9", title: "Gone", createdAt: "2026-10-27T00:00:00Z", description: "gone" }]),
    /deleted-scene-z9z9/,
  ],
  ["a resolved Scene has no stub", (root: string) => rmSync(join(root, "scenes", id, "index.html")), /index\.html.*stub/],
  ["a record fails validation", (root: string) => editJson(root, "library/palettes/cosy-night.json", (p) => { p.colours = []; }), /validate/],
] as const) {
  test(`assemble fails with a JSON error and keeps the earlier dist/ when ${name}`, () => {
    const root = siteTree();
    assert.equal(runScript(root, "assemble").code, 0);
    const before = files(join(root, "dist"));
    breakTree(root);
    const { code, out } = runScript(root, "assemble");
    assert.equal(code, 1);
    assert.equal(out.ok, false);
    assert.match(out.error, message);
    assert.deepEqual(files(join(root, "dist")), before);
  });
}
