import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ambientRecordCount, editJson, fixtureScene, fixtures, makeTree, readJson, validate, writeJson, type ValidateResult } from "./helpers.ts";

test("a resolved fixture Scene validates and is reported resolved", () => {
  const { code, report } = validate(makeTree());
  assert.equal(code, 0);
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.checked, { scenes: 1, elements: 3, palettes: 1, ambient: ambientRecordCount });
  assert.deepEqual(report.scenes, [
    { id: "fixture-rainy-desk-a1b2", file: fixtureScene, declared: "resolved", status: "resolved", pending: [] },
  ]);
});

const CAT = "library/elements/cat-tabby-asleep-01.json";
const WINDOW = "library/elements/window-wood-transparent-panes-01.json";
const sceneDir = "scenes/fixture-rainy-desk-a1b2";

function failsWith(result: ValidateResult, file: string, path: string, message: RegExp): void {
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.report.ok, false);
  const hit = result.report.errors.find((e: any) => e.file === file && e.path === path && message.test(e.message));
  assert.ok(hit, `expected an error at ${file} ${path} matching ${message}, got ${JSON.stringify(result.report.errors, null, 2)}`);
  assert.match(result.stderr, new RegExp(`${file.replace(/[.]/g, "\\.")}: ${path.replace(/[.[\]]/g, "\\$&") || "\\(root\\)"}: `));
}

test("a Placement whose Element is not in the Element library fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[2].placements[0].element = "lamp-brass-desk-01"; });
  failsWith(validate(root), fixtureScene, "layers[2].placements[0].element", /lamp-brass-desk-01 is not in the Element library/);
});

test("a Scene plan naming a Palette that does not exist fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.palette = "sunny-meadow"; });
  failsWith(validate(root), fixtureScene, "palette", /Palette sunny-meadow does not exist/);
});

test("an Element record naming a Palette that does not exist fails", () => {
  const root = makeTree();
  editJson(root, WINDOW, (record) => { record.palette = "sunny-meadow"; });
  failsWith(validate(root), WINDOW, "palette", /Palette sunny-meadow does not exist/);
});

for (const [name, path] of [
  ["music.mp3", "soundtrack.music.file"],
  ["room.ogg", "soundtrack.ambient[0].file"],
  ["thunder.ogg", "soundtrack.oneshots[0].file"],
  ["poster.png", ""],
] as const) {
  test(`a resolved Scene without ${name} beside the plan fails`, () => {
    const root = makeTree();
    rmSync(join(root, sceneDir, name));
    failsWith(validate(root), fixtureScene, path, new RegExp(`declared resolved but ${name.replace(".", "\\.")} is missing`));
  });
}

test("a draft Scene with missing files passes and is reported draft with what is pending", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.status = "draft"; });
  rmSync(join(root, sceneDir, "poster.png"));
  rmSync(join(root, sceneDir, "room.ogg"));
  const { code, report } = validate(root);
  assert.equal(code, 0);
  assert.deepEqual(report.scenes[0].status, "draft");
  assert.deepEqual(report.scenes[0].pending.map((p: any) => p.path), ["soundtrack.ambient[0].file", ""]);
});

test("a draft Scene with every file in place is reported resolved", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.status = "draft"; });
  const { code, report } = validate(root);
  assert.equal(code, 0);
  assert.equal(report.scenes[0].declared, "draft");
  assert.equal(report.scenes[0].status, "resolved");
});

test("a curated source with no Sound library record keeps the Scene draft", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.soundtrack.ambient[0].source.id = "freesound-rain-missing-999999"; });
  failsWith(validate(root), fixtureScene, "soundtrack.ambient[0].source.id", /no record freesound-rain-missing-999999/);
});

test("a generated source with no Sound library record id yet keeps the Scene draft", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => {
    plan.status = "draft";
    plan.soundtrack.ambient[0].source = { kind: "generated", service: "elevenlabs-fal", brief: "room tone, quiet" };
  });
  const { code, report } = validate(root);
  assert.equal(code, 0);
  assert.equal(report.scenes[0].status, "draft");
  assert.deepEqual(report.scenes[0].pending.map((p: any) => p.path), ["soundtrack.ambient[0].source"]);
});

test("a generated source naming a missing Sound library record keeps the Scene draft", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => {
    plan.soundtrack.ambient[0].source = { kind: "generated", service: "elevenlabs-fal", brief: "room tone, quiet", id: "elevenlabs-room-01" };
  });
  failsWith(validate(root), fixtureScene, "soundtrack.ambient[0].source.id", /no record elevenlabs-room-01/);
});

test("a generated source naming its Sound library record resolves", () => {
  const root = makeTree();
  const record = readJson(root, "library/ambient/freesound-room-tone-641306.json");
  writeJson(root, "library/ambient/elevenlabs-room-01.json", { ...record, id: "elevenlabs-room-01", brief: "room tone, quiet" });
  editJson(root, fixtureScene, (plan) => {
    plan.soundtrack.ambient[0].source = { kind: "generated", service: "elevenlabs-fal", brief: "room tone, quiet", id: "elevenlabs-room-01" };
  });
  const { code, report, stderr } = validate(root);
  assert.equal(code, 0, stderr);
  assert.equal(report.scenes[0].status, "resolved");
});

for (const [what, breakIt] of [
  ["an Element PNG is missing", (root: string) => rmSync(join(root, "library/elements/window-wood-transparent-panes-01.png"))],
  ["an Element record fails its schema", (root: string) => editJson(root, WINDOW, (record) => { record.width = "wide"; })],
  ["a Frame strip is missing", (root: string) => rmSync(join(root, "library/elements/cat-tabby-asleep-01.strip.png"))],
  ["its Palette file fails its schema", (root: string) => editJson(root, "library/palettes/cosy-night.json", (palette) => { palette.colours = []; })],
  ["a curated Sound library record has no file beside it", (root: string) => editJson(root, "library/ambient/freesound-room-tone-641306.json", (record) => { record.file = "gone.ogg"; })],
] as const) {
  test(`a Scene is reported draft when ${what}`, () => {
    const root = makeTree();
    editJson(root, fixtureScene, (plan) => { plan.status = "draft"; });
    breakIt(root);
    const { code, report, stderr } = validate(root);
    assert.equal(code, 1, stderr);
    assert.equal(report.scenes[0].status, "draft");
  });
}

test("a Frame strip whose width does not match frames x width fails", () => {
  const root = makeTree();
  copyFileSync(join(root, "library/elements/cat-tabby-asleep-01.png"), join(root, "library/elements/cat-tabby-asleep-01.strip.png"));
  failsWith(validate(root), CAT, "animation.frames", /Frame strip .* is 24x16, record says 96x16/);
});

test("a Frame strip record claiming more frames than the strip holds fails", () => {
  const root = makeTree();
  editJson(root, CAT, (record) => { record.animation.frames = 5; });
  failsWith(validate(root), CAT, "animation.frames", /is 96x16, record says 120x16/);
});

test("an Element whose Frame strip file is missing fails", () => {
  const root = makeTree();
  rmSync(join(root, "library/elements/cat-tabby-asleep-01.strip.png"));
  failsWith(validate(root), CAT, "animation.frames", /Frame strip .* is missing/);
});

test("an Element PNG whose size does not match the record fails", () => {
  const root = makeTree();
  editJson(root, WINDOW, (record) => { record.width = 64; });
  failsWith(validate(root), WINDOW, "", /Element PNG .* is 48x48, record says 64x48/);
});

test("an animation override on a Placement whose Element has no Frame strip fails a resolved Scene", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[2].placements[0].animation = { fps: 4 }; });
  failsWith(validate(root), fixtureScene, "layers[2].placements[0].animation", /declared resolved but .*has no Frame strip/);
});

test("an animation override waiting on a Frame strip keeps a draft Scene pending", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => {
    plan.status = "draft";
    plan.layers[2].placements[0].animation = { fps: 4 };
  });
  const { code, report } = validate(root);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.equal(report.scenes[0].status, "draft");
  assert.match(report.scenes[0].pending.find((p: any) => p.path === "layers[2].placements[0].animation")?.message ?? "", /has no Frame strip/);
});

test("an explicit frame order past the end of the Frame strip fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[2].placements[2].animation.order = [0, 1, 4]; });
  failsWith(validate(root), fixtureScene, "layers[2].placements[2].animation.order[2]", /frame 4 is beyond the 4-frame strip/);
});

test("a record whose id does not match its file name fails", () => {
  const root = makeTree();
  editJson(root, WINDOW, (record) => { record.id = "window-wood-plain-01"; });
  failsWith(validate(root), WINDOW, "id", /does not match file name/);
});

test("a Scene plan whose id does not match its folder fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.id = "another-scene-zz99"; });
  failsWith(validate(root), fixtureScene, "id", /does not match Scene folder fixture-rainy-desk-a1b2/);
});

test("a file that is not valid JSON fails at the root path", () => {
  const root = makeTree();
  writeFileSync(join(root, WINDOW), "{ not json");
  failsWith(validate(root), WINDOW, "", /not valid JSON/);
});

test("the example Scene plan from the spec validates as a draft", () => {
  const root = makeTree();
  const example = JSON.parse(readFileSync(join(fixtures, "spec-example-scene.json"), "utf8"));
  writeJson(root, "scenes/rainy-desk-night-k7f2/scene.json", example);
  const { code, report, stderr } = validate(root);
  assert.equal(code, 0, stderr);
  const scene = report.scenes.find((s: any) => s.id === "rainy-desk-night-k7f2");
  assert.equal(scene.status, "draft");
  assert.ok(scene.pending.some((p: any) => p.path === "layers[1].placements[0].generate"));
});

test("a layer with both fill and placements fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[1].fill = 2; });
  failsWith(validate(root), fixtureScene, "layers[1]", /either fill or placements, never both/);
});

const ambientAt = (distance: string, id = "freesound-room-tone-641306") => ({ source: { kind: "curated", id }, file: "room.ogg", distance });

test("more than 2 ambient at one Distance fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.soundtrack.ambient = [ambientAt("near"), ambientAt("near"), ambientAt("near")]; });
  failsWith(validate(root), fixtureScene, "soundtrack.ambient[2]", /at most 2 ambient at Distance near/);
});

test("more than 5 ambient in one Scene fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => {
    plan.soundtrack.ambient = ["near", "near", "mid", "mid", "far", "far"].map((d) => ambientAt(d));
  });
  failsWith(validate(root), fixtureScene, "soundtrack.ambient", /at most 5 ambient per Scene/);
});

test("more than 2 One-shots in one Scene fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => {
    const shot = plan.soundtrack.oneshots[0];
    plan.soundtrack.oneshots = [shot, shot, shot];
  });
  failsWith(validate(root), fixtureScene, "soundtrack.oneshots", /at most 2 One-shots per Scene/);
});

test("an unknown Primitive type fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.primitives.push({ type: "fog" }); });
  failsWith(validate(root), fixtureScene, "primitives[3].type", /./);
});

test("given paths, validate reports only the files under them", () => {
  const root = makeTree();
  editJson(root, WINDOW, (record) => { record.palette = "sunny-meadow"; });
  const { code, report } = validate(root, "library/ambient");
  assert.equal(code, 0);
  assert.deepEqual(report.checked, { scenes: 0, elements: 0, palettes: 0, ambient: ambientRecordCount });
});

test("a resolved Scene whose Element PNG is missing fails on its own file when validated by path", () => {
  const root = makeTree();
  rmSync(join(root, "library/elements/window-wood-transparent-panes-01.png"));
  const result = validate(root, sceneDir);
  failsWith(result, fixtureScene, "", /declared resolved but library\/elements\/window-wood-transparent-panes-01\.json fails validation/);
  assert.equal(result.report.scenes[0].status, "draft");
});
