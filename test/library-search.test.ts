import { rmSync } from "node:fs";
import { join } from "node:path";
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

// The Sound library grows with every Scene, so sound searches run against fixed records instead of the real one.
function treeWithSounds(): string {
  const root = makeTree();
  rmSync(join(root, "library/ambient"), { recursive: true });
  const sound = (id: string, kind: string, subject: string, tags: string[], distance: string[]) =>
    writeJson(root, `library/ambient/${id}.json`, {
      id, kind, distance, subject, tags,
      source: "freesound", sourceId: 1, sourceUrl: "https://freesound.org/s/1/", sourceName: `${id}.wav`,
      author: "fixture", licence: "CC0-1.0", licenceUrl: "http://creativecommons.org/publicdomain/zero/1.0/",
      attribution: "fixture", file: `${id}.ogg`, durationSec: 10, sampleRate: 48000, channels: 2,
      processing: { method: "cut" }, fetchedAt: "2026-10-25",
    });
  sound("night-interior-01", "loop", "night interior", ["night", "room"], ["mid"]);
  sound("owl-tawny-01", "oneshot", "owl", ["owl", "night"], ["far"]);
  sound("rain-window-01", "loop", "rain on glass", ["rain", "window"], ["near"]);
  return root;
}

const ids = (out: any) => out.results.map((r: any) => r.id);

test("library-search ranks a subject match above a tags match above a brief match", () => {
  const { code, out, stderr } = runScript(treeWithCurtain(), "library-search", "window");
  assert.equal(code, 0, stderr);
  assert.equal(out.ok, true);
  assert.deepEqual(ids(out), ["window-wood-transparent-panes-01", "curtain-red-velvet-01", "skyline-night-warm-windows-01"]);
});

test("library-search prints id, kind, subject, tags, Palette, size, whether a Frame strip exists and the Finish", () => {
  const { out } = runScript(makeTree(), "library-search", "cat");
  assert.deepEqual(out.results, [
    { id: "cat-tabby-asleep-01", kind: "prop", subject: "cat", tags: ["cat", "asleep", "tabby"], palette: "fixture-night-v2", size: "24x16", hasStrip: true, finish: "service", matched: ["subject", "tags", "brief"] },
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
  const { code, out, stderr } = runScript(treeWithSounds(), "library-search", "--sounds", "night");
  assert.equal(code, 0, stderr);
  assert.deepEqual(out.results, [
    { id: "night-interior-01", kind: "loop", subject: "night interior", tags: ["night", "room"], distance: ["mid"], matched: ["subject", "tags"] },
    { id: "owl-tawny-01", kind: "oneshot", subject: "owl", tags: ["owl", "night"], distance: ["far"], matched: ["tags"] },
  ]);
});

for (const [what, args, message] of [
  ["the size is not WxH", ["window", "--size", "big"], /--size must be WxH/],
  ["a flag has no value", ["window", "--palette"], /--palette needs a value/],
  ["a flag is unknown", ["window", "--colour", "red"], /unknown option --colour/],
  ["--sounds is given a Palette", ["--sounds", "rain", "--palette", "fixture-night-v2"], /--sounds does not take --palette, --size or --finish/],
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

function treeWithShelves(): string {
  const root = makeTree();
  const window = readJson(root, WINDOW);
  const shelf = { ...window, subject: "shelf", tags: ["shelf", "wood"], brief: "plain wooden shelf" };
  writeJson(root, "library/elements/shelf-wood-plain-01.json", { ...shelf, id: "shelf-wood-plain-01" });
  writeJson(root, "library/elements/shelf-wood-plain-02.json", {
    ...shelf, id: "shelf-wood-plain-02", service: "local", model: "kit/shelf", generator: "shelf", params: { frame: 14, shelves: 3 }, seed: null,
  });
  writeJson(root, "library/elements/shelf-wood-dusk-01.json", { ...shelf, id: "shelf-wood-dusk-01", palette: "golden-hour" });
  writeJson(root, "library/elements/shelf-wood-night-01.json", { ...shelf, id: "shelf-wood-night-01", palette: "cosy-night" });
  return root;
}

test("library-search --palette matches a Palette by its colours, so a v1 cosy-night Element matches cosy-night-v2", () => {
  const { code, out, stderr } = runScript(treeWithShelves(), "library-search", "shelf", "--palette", "cosy-night-v2");
  assert.equal(code, 0, stderr);
  assert.deepEqual(ids(out), ["shelf-wood-night-01", "shelf-wood-plain-01", "shelf-wood-plain-02"]);
  assert.equal(out.results[0].palette, "cosy-night");
});

test("library-search prints each hit's Finish", () => {
  const { out } = runScript(treeWithShelves(), "library-search", "shelf", "--palette", "fixture-night-v2");
  assert.deepEqual(out.results.map((r: any) => [r.id, r.finish]), [
    ["shelf-wood-night-01", "service"], ["shelf-wood-plain-01", "service"], ["shelf-wood-plain-02", "local"],
  ]);
});

test("library-search --finish ranks hits with the asked Finish first when both fit", () => {
  const local = runScript(treeWithShelves(), "library-search", "shelf", "--palette", "cosy-night-v2", "--finish", "local");
  assert.equal(local.code, 0, local.stderr);
  assert.deepEqual(ids(local.out), ["shelf-wood-plain-02", "shelf-wood-night-01", "shelf-wood-plain-01"]);
  const service = runScript(treeWithShelves(), "library-search", "shelf", "--palette", "cosy-night-v2", "--finish", "service");
  assert.deepEqual(ids(service.out), ["shelf-wood-night-01", "shelf-wood-plain-01", "shelf-wood-plain-02"]);
});

test("library-search refuses a Finish other than local or service, and an unknown Palette", () => {
  const finish = runScript(makeTree(), "library-search", "shelf", "--finish", "fancy");
  assert.equal(finish.code, 1);
  assert.match(finish.out.error, /--finish must be local or service/);
  const palette = runScript(makeTree(), "library-search", "shelf", "--palette", "no-such-palette");
  assert.equal(palette.code, 1);
  assert.match(palette.out.error, /no Palette no-such-palette/);
});
