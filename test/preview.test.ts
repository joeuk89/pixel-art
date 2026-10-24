import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { editJson, fixtureScene, makeTree, readJson, runScript, writeJson } from "./helpers.ts";

const id = "fixture-rainy-desk-a1b2";
const NEW_ELEMENT = "cat-tabby-dozing-01";

const git = (root: string, ...args: string[]) => {
  const run = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
};

// A repo whose last commit holds the library, with a new Scene, one new Element and its rendered files left uncommitted.
function repoTree(tests: "pass" | "fail" = "pass"): string {
  const root = makeTree();
  writeJson(root, "package.json", { private: true, scripts: { test: `node -e "process.exit(${tests === "pass" ? 0 : 1})"` } });
  for (const name of ["cat-tabby-asleep-01", "skyline-night-warm-windows-01", "window-wood-transparent-panes-01"]) {
    editJson(root, `library/elements/${name}.json`, (record) => { record.firstScene = "older-scene-x1y2"; });
  }
  git(root, "init", "-q");
  git(root, "add", "library", "package.json");
  git(root, "commit", "-qm", "library");
  for (const ext of ["png", "strip.png"]) cpSync(join(root, `library/elements/cat-tabby-asleep-01.${ext}`), join(root, `library/elements/${NEW_ELEMENT}.${ext}`));
  writeJson(root, `library/elements/${NEW_ELEMENT}.json`, { ...readJson(root, "library/elements/cat-tabby-asleep-01.json"), id: NEW_ELEMENT, firstScene: id });
  editJson(root, fixtureScene, (plan) => {
    plan.status = "draft";
    plan.layers[2].placements[1].element = NEW_ELEMENT;
  });
  assert.equal(runScript(root, "poster", fixtureScene).code, 0);
  assert.equal(runScript(root, "stage", fixtureScene).code, 0);
  return root;
}

const staged = (root: string) => git(root, "diff", "--cached", "--name-only").split("\n").filter(Boolean).sort();
const commits = (root: string) => git(root, "rev-list", "--count", "HEAD").trim();

test("preview marks the Scene resolved, stages its files and prints the URL, cost, ledger and a commit message without committing", () => {
  const root = repoTree();
  const { code, out, stderr } = runScript(root, "preview", fixtureScene);
  assert.equal(code, 0, stderr + JSON.stringify(out));
  assert.equal(out.ok, true);
  assert.equal(out.previewUrl, `http://localhost:8000/scenes/${id}/`);
  assert.equal(out.devServer.url, "http://localhost:8000/");
  assert.equal(typeof out.devServer.listening, "boolean");
  assert.equal(readJson(root, fixtureScene).status, "resolved");

  const expected = [
    "gallery.json",
    `library/elements/${NEW_ELEMENT}.json`,
    `library/elements/${NEW_ELEMENT}.png`,
    `library/elements/${NEW_ELEMENT}.strip.png`,
    ...["index.html", "music.mp3", "poster-og.png", "poster.png", "room.ogg", "scene.json", "thunder.ogg"].map((f) => `scenes/${id}/${f}`),
  ];
  assert.deepEqual(out.staged, expected);
  assert.deepEqual(staged(root), expected);
  assert.equal(commits(root), "1");

  assert.deepEqual(out.cost, { pixellabGenerations: 4, meteredUsd: { stability: 0.2 }, attemptsAbandoned: 0, approvedOverage: null });
  assert.equal(out.ledger.pixellabGenerations.ceiling, 2000);
  assert.equal(out.ledger.metered.ceilingGbp, 50);
  assert.deepEqual(out.ledger.afterCommit, { pixellabGenerations: 4, meteredUsd: 0.2 });
  assert.deepEqual(out.abandoned, []);
  assert.deepEqual(out.elements, { generated: [NEW_ELEMENT], reused: ["skyline-night-warm-windows-01", "window-wood-transparent-panes-01", "cat-tabby-asleep-01"] });
  assert.match(out.commitMessage, /^Add the Scene "Fixture rainy desk"\n\n/);
  assert.match(out.commitMessage, new RegExp(`Scene id: ${id}`));
  assert.match(out.commitMessage, new RegExp(`Generated: ${NEW_ELEMENT}`));
  assert.match(out.commitMessage, /Cost: 4 PixelLab generations, \$0\.2 metered/);
});

test("the preview report says which Elements were substituted, dropped or left as stills", () => {
  const root = repoTree();
  editJson(root, fixtureScene, (plan) => {
    plan.layers[2].placements[2].element = "cat-tabby-curled-01";
    plan.layers[2].placements[2].generate = { kind: "prop", brief: "tabby cat curled up", realSize: { w: 0.5, h: 0.25 }, tags: ["cat"] };
  });
  const abandoned = runScript(root, "generate-element", fixtureScene, "cat-2", "--abandon", "--substitute", NEW_ELEMENT);
  assert.equal(abandoned.code, 0, abandoned.stderr);
  assert.equal(runScript(root, "poster", fixtureScene).code, 0);
  assert.equal(runScript(root, "stage", fixtureScene).code, 0);

  const { code, out, stderr } = runScript(root, "preview", fixtureScene);
  assert.equal(code, 0, stderr + JSON.stringify(out));
  assert.deepEqual(out.abandoned, [{ placement: "cat-2", element: "cat-tabby-curled-01", attempts: 0, outcome: "substituted", substitute: NEW_ELEMENT }]);
  assert.match(out.commitMessage, /Substituted: cat-tabby-dozing-01 for cat-tabby-curled-01 \(cat-2\)/);
});

test("a failed hard check stops the preview: nothing is staged and the Scene stays draft", () => {
  const root = repoTree("fail");
  const before = readFileSync(join(root, fixtureScene), "utf8");
  const { code, out } = runScript(root, "preview", fixtureScene);
  assert.equal(code, 1);
  assert.equal(out.ok, false);
  assert.deepEqual(out.checks.filter((c: any) => !c.ok).map((c: any) => c.name), ["tests"]);
  assert.equal(readFileSync(join(root, fixtureScene), "utf8"), before);
  assert.equal(readJson(root, fixtureScene).status, "draft");
  assert.deepEqual(staged(root), []);
  assert.equal(commits(root), "1");
});
