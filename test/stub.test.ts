import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { editJson, fixtureScene, makeTree, readJson, runScript, writeJson } from "./helpers.ts";

const id = "fixture-rainy-desk-a1b2";
const sceneDir = `scenes/${id}`;
const SITE = "https://joeuk89.github.io/pixel-art/";

function meta(html: string, property: string): string | undefined {
  return html.match(new RegExp(`<meta property="${property}" content="([^"]*)">`))?.[1];
}

function copyScene(root: string, newId: string, edit: (plan: any) => void): void {
  cpSync(join(root, sceneDir), join(root, "scenes", newId), { recursive: true });
  editJson(root, `scenes/${newId}/scene.json`, (plan) => {
    plan.id = newId;
    edit(plan);
  });
}

test("stage writes the Scene stub with Open Graph title and Poster tags and a relative script tag", () => {
  const root = makeTree();
  const { code, out, stderr } = runScript(root, "stage", fixtureScene);
  assert.equal(code, 0, stderr);
  assert.deepEqual(out, {
    ok: true,
    scene: id,
    stub: `${sceneDir}/index.html`,
    gallery: "gallery.json",
    previewUrl: `http://localhost:8000/${sceneDir}/`,
  });
  const html = readFileSync(join(root, sceneDir, "index.html"), "utf8");
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Fixture rainy desk<\/title>/);
  assert.equal(meta(html, "og:title"), "Fixture rainy desk");
  assert.equal(meta(html, "og:description"), "A cosy desk by a rainy window at night, with a cat asleep in the lamplight.");
  assert.equal(meta(html, "og:image"), `${SITE}${sceneDir}/poster-og.png`);
  assert.equal(meta(html, "og:url"), `${SITE}${sceneDir}/`);
  assert.match(html, /<script src="\.\.\/\.\.\/viewer\.js" defer><\/script>/);
});

test("stage escapes the title in the stub", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.title = `Tom & Jerry's "<desk>"`; });
  assert.equal(runScript(root, "stage", fixtureScene).code, 0);
  const html = readFileSync(join(root, sceneDir, "index.html"), "utf8");
  assert.match(html, /<title>Tom &amp; Jerry&#39;s &quot;&lt;desk&gt;&quot;<\/title>/);
  assert.equal(meta(html, "og:title"), "Tom &amp; Jerry&#39;s &quot;&lt;desk&gt;&quot;");
});

test("stage rewrites gallery.json with only resolved Scenes, newest first", () => {
  const root = makeTree();
  copyScene(root, "snowy-street-dusk-b3c4", (plan) => {
    plan.title = "Snowy street at dusk";
    plan.description = "Snow settles on a quiet street at dusk.";
    plan.createdAt = "2026-10-25T09:00:00Z";
  });
  copyScene(root, "unfinished-garden-c5d6", (plan) => {
    plan.status = "draft";
    plan.createdAt = "2026-10-26T09:00:00Z";
  });
  rmSync(join(root, "scenes/unfinished-garden-c5d6/poster.png"));
  writeJson(root, "gallery.json", [{ id: "deleted-scene-z9z9", title: "Gone", createdAt: "2026-10-27T00:00:00Z", description: "gone" }]);

  const { code, stderr } = runScript(root, "stage", fixtureScene);
  assert.equal(code, 0, stderr);
  assert.deepEqual(readJson(root, "gallery.json"), [
    { id: "snowy-street-dusk-b3c4", title: "Snowy street at dusk", createdAt: "2026-10-25T09:00:00Z", description: "Snow settles on a quiet street at dusk." },
    { id, title: "Fixture rainy desk", createdAt: "2026-10-24T20:00:00Z", description: "A cosy desk by a rainy window at night, with a cat asleep in the lamplight." },
  ]);
});

test("stage fails with a JSON error and writes nothing when the Scene plan does not parse", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { delete plan.title; });
  const { code, out } = runScript(root, "stage", fixtureScene);
  assert.equal(code, 1);
  assert.equal(out.ok, false);
  assert.match(out.error, /title/);
  assert.equal(existsSync(join(root, sceneDir, "index.html")), false);
  assert.equal(existsSync(join(root, "gallery.json")), false);
});
