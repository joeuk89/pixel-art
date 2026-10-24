import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTree, readJson, runScript, writeJson } from "./helpers.ts";

const WINDOW = "library/elements/window-wood-transparent-panes-01.json";

function treeWithCurtain(): string {
  const root = makeTree();
  const window = readJson(root, WINDOW);
  writeJson(root, "library/elements/curtain-red-velvet-01.json", {
    ...window,
    id: "curtain-red-velvet-01",
    subject: "curtain",
    tags: ["curtain", "window", "fabric"],
    brief: "heavy red velvet curtain",
    palette: "warm-dusk",
  });
  return root;
}

const ids = (out: any) => out.results.map((r: any) => r.id);

test("library-search ranks a subject match above a tags match above a brief match", () => {
  const { code, out, stderr } = runScript(treeWithCurtain(), "library-search", "window");
  assert.equal(code, 0, stderr);
  assert.equal(out.ok, true);
  assert.deepEqual(ids(out), ["window-wood-transparent-panes-01", "curtain-red-velvet-01", "skyline-night-warm-windows-01"]);
});

test("library-search prints id, kind, subject, tags, Palette, size and whether a Frame strip exists", () => {
  const { out } = runScript(makeTree(), "library-search", "cat");
  assert.deepEqual(out.results, [
    { id: "cat-tabby-asleep-01", kind: "prop", subject: "cat", tags: ["cat", "asleep", "tabby"], palette: "fixture-night-v2", size: "24x16", hasStrip: true, matched: ["subject", "tags", "brief"] },
  ]);
});

test("a subject match outranks a record that matches more words in its tags and brief", () => {
  const { out } = runScript(treeWithCurtain(), "library-search", "window", "fabric", "velvet");
  assert.deepEqual(ids(out), ["window-wood-transparent-panes-01", "curtain-red-velvet-01", "skyline-night-warm-windows-01"]);
});

test("library-search filters by Palette", () => {
  const { code, out } = runScript(treeWithCurtain(), "library-search", "window", "--palette", "fixture-night-v2");
  assert.equal(code, 0);
  assert.deepEqual(ids(out), ["window-wood-transparent-panes-01", "skyline-night-warm-windows-01"]);
});

test("library-search filters by canvas size", () => {
  const { code, out } = runScript(treeWithCurtain(), "library-search", "window", "--size", "256x128");
  assert.equal(code, 0);
  assert.deepEqual(ids(out), ["skyline-night-warm-windows-01"]);
});

test("library-search with filters and no words lists every record that passes them", () => {
  const { out } = runScript(treeWithCurtain(), "library-search", "--size", "48x48");
  assert.deepEqual(ids(out), ["curtain-red-velvet-01", "window-wood-transparent-panes-01"]);
});

test("library-search prints an empty list when nothing matches", () => {
  const { code, out } = runScript(makeTree(), "library-search", "teapot");
  assert.equal(code, 0);
  assert.deepEqual(out.results, []);
});

test("library-search --sounds searches the Sound library and prints kind and Distance", () => {
  const { code, out, stderr } = runScript(makeTree(), "library-search", "--sounds", "night");
  assert.equal(code, 0, stderr);
  assert.deepEqual(out.results, [
    { id: "freesound-night-interior-613147", kind: "loop", subject: "night interior", tags: ["night", "room", "interior", "quiet", "bedroom", "bed"], distance: ["mid"], matched: ["subject", "tags"] },
    { id: "freesound-crickets-night-167304", kind: "loop", subject: "crickets", tags: ["crickets", "insects", "night", "summer", "countryside", "garden", "bed"], distance: ["mid", "far"], matched: ["tags"] },
    { id: "freesound-owl-tawny-454842", kind: "oneshot", subject: "owl", tags: ["owl", "tawny owl", "hoot", "night", "countryside"], distance: ["far"], matched: ["tags"] },
    { id: "freesound-rain-window-242889", kind: "loop", subject: "rain on glass", tags: ["rain", "window", "glass", "indoors", "night", "weather", "bed"], distance: ["near", "mid"], matched: ["tags"] },
  ]);
});

for (const [what, args, message] of [
  ["the size is not WxH", ["window", "--size", "big"], /--size must be WxH/],
  ["a flag has no value", ["window", "--palette"], /--palette needs a value/],
  ["a flag is unknown", ["window", "--colour", "red"], /unknown option --colour/],
  ["--sounds is given a Palette", ["--sounds", "rain", "--palette", "fixture-night-v2"], /--sounds does not take --palette or --size/],
  ["no words and no filters are given", [], /usage/],
] as const) {
  test(`library-search exits non-zero with one JSON object when ${what}`, () => {
    const { code, out } = runScript(makeTree(), "library-search", ...args);
    assert.equal(code, 1);
    assert.equal(out.ok, false);
    assert.match(out.error, message);
  });
}

test("library-search fails naming the file when an Element record is broken", () => {
  const root = makeTree();
  writeJson(root, WINDOW, { id: "window-wood-transparent-panes-01" });
  const { code, out } = runScript(root, "library-search", "window");
  assert.equal(code, 1);
  assert.match(out.error, /window-wood-transparent-panes-01\.json/);
});
