import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ambientRecordCount, paletteCount, editJson, fixtureScene, fixtures, makeTree, readJson, validate, writeJson, type ValidateResult } from "./helpers.ts";

test("a resolved fixture Scene validates and is reported resolved", () => {
  const { code, report } = validate(makeTree());
  assert.equal(code, 0);
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.checked, { scenes: 1, elements: 4, palettes: paletteCount, ambient: ambientRecordCount });
  assert.deepEqual(report.scenes, [
    { id: "fixture-rainy-desk-a1b2", file: fixtureScene, declared: "resolved", status: "resolved", pending: [] },
  ]);
});

const CAT = "library/elements/cat-tabby-asleep-01.json";
const SKYLINE = "library/elements/skyline-night-warm-windows-01.json";
const PALETTE = "library/palettes/fixture-night-v2.json";

test("a v1 Scene plan fails with a message naming schemaVersion", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.schemaVersion = 1; });
  failsWith(validate(root), fixtureScene, "schemaVersion", /schemaVersion 1 .*2/);
});

test("Layers out of Plane order fail", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[2].plane = "near"; });
  failsWith(validate(root), fixtureScene, "layers[3].plane", /Plane order: mid after near/);
});

test("two Layers with the same name fail", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[2].name = "stars"; });
  failsWith(validate(root), fixtureScene, "layers[2].name", /duplicate Layer name stars/);
});

test("a Layer name that is not a slug fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[2].name = "City Lights"; });
  failsWith(validate(root), fixtureScene, "layers[2].name", /slug/);
});

test("a Layer scale is allowed on a far placements Layer only", () => {
  const ok = makeTree();
  editJson(ok, fixtureScene, (plan) => { plan.layers[2].scale = 8; });
  assert.equal(validate(ok).code, 0);
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[3].scale = 8; });
  failsWith(validate(root), fixtureScene, "layers[3].scale", /only a far Layer/);
});

test("tileX on an Element that is not seamless fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[2].placements[0].tileX = true; });
  failsWith(validate(root), fixtureScene, "layers[2].placements[0].tileX", /skyline-night-warm-windows-01 is not seamless/);
});

for (const [what, side] of [["under 16", 12], ["over 256", 260], ["not a multiple of 4", 30]] as const) {
  test(`a prop side ${what} fails`, () => {
    const root = makeTree();
    editJson(root, WINDOW, (record) => { record.width = side; });
    failsWith(validate(root), WINDOW, "width", /./);
  });
}

test("a prop side of 256 is allowed by the record schema", () => {
  const root = makeTree();
  editJson(root, WINDOW, (record) => { record.width = 256; });
  const { report } = validate(root);
  assert.deepEqual(report.errors.filter((e: any) => e.file === WINDOW).map((e: any) => e.path), [""]);
});

for (const [axis, size] of [["width", 388], ["height", 244]] as const) {
  test(`a Backdrop ${axis} over the 384x240 canvas fails`, () => {
    const root = makeTree();
    editJson(root, SKYLINE, (record) => { record[axis] = size; });
    failsWith(validate(root), SKYLINE, axis, /./);
  });
}

test("a Backdrop generate size over 384x240 or off the 4 px grid fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => {
    plan.status = "draft";
    plan.layers[2].placements[0].generate = { kind: "backdrop", brief: "city at night", tags: ["city"], size: { w: 400, h: 124 } };
  });
  failsWith(validate(root), fixtureScene, "layers[2].placements[0].generate.size.w", /./);
  editJson(root, fixtureScene, (plan) => { plan.layers[2].placements[0].generate.size = { w: 256, h: 126 }; });
  failsWith(validate(root), fixtureScene, "layers[2].placements[0].generate.size.h", /./);
});

test("a texture record must be seamless", () => {
  const root = makeTree();
  editJson(root, "library/elements/sky-stars-night-01.json", (record) => { delete record.seamless; });
  failsWith(validate(root), "library/elements/sky-stars-night-01.json", "seamless", /./);
});

test("a v2 Scene naming a Palette without ramps fails", () => {
  const root = makeTree();
  editJson(root, PALETTE, (palette) => { delete palette.ramps; });
  failsWith(validate(root), fixtureScene, "palette", /Palette fixture-night-v2 has no ramps/);
});

test("a Ramp table with the wrong length or an index off the Palette fails", () => {
  const root = makeTree();
  editJson(root, PALETTE, (palette) => { palette.ramps.pop(); });
  failsWith(validate(root), PALETTE, "ramps", /one ramp per colour: 16 colours, 15 ramps/);
  editJson(root, PALETTE, (palette) => { palette.ramps.push({ dark: 0, warm: 16, cool: 1 }); });
  failsWith(validate(root), PALETTE, "ramps[15].warm", /colour index 16 is not in this Palette/);
});

test("a companionPalette with a different colour count fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.variants[0].companionPalette = "golden-hour-v2"; });
  failsWith(validate(root), fixtureScene, "variants[0].companionPalette", /golden-hour-v2 has 20 colours, the Scene's Palette has 16/);
});

test("a companionPalette with the same colour count and ramps passes", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.variants[0].companionPalette = "cosy-night-v2"; });
  const { code, stderr } = validate(root);
  assert.equal(code, 0, stderr);
});

test("a companionPalette without ramps or that does not exist fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.variants[0].companionPalette = "cosy-night"; plan.variants[1].companionPalette = "moonlight-v2"; });
  const result = validate(root);
  failsWith(result, fixtureScene, "variants[0].companionPalette", /Palette cosy-night has no ramps/);
  failsWith(result, fixtureScene, "variants[1].companionPalette", /Palette moonlight-v2 does not exist/);
});

test("a Variant offset naming a missing Layer fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.variants[0].ambient.layers.curtains = -3; });
  failsWith(validate(root), fixtureScene, "variants[0].ambient.layers.curtains", /no Layer curtains/);
});

const lamp = { type: "point", id: "lamp", anchor: "cat", offset: { x: 12, y: 0 }, radius: 80, strength: 2.5, tint: "warm" };

test("point and beam Lights with flicker and halo blocks validate", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => {
    plan.variants[1].lights = [
      { ...lamp, flicker: { depth: 0.12, rate: 0.8 }, halo: { colour: 8, radius: 36, strength: 0.6 } },
      { type: "point", id: "spill", at: { x: 190, y: 52 }, radius: 100, strength: 0.75, tint: "cool" },
      { type: "beam", id: "moon", corners: [{ x: 170, y: 76 }, { x: 214, y: 76 }, { x: 250, y: 239 }, { x: 150, y: 239 }], strength: 1, tint: "cool", softness: 6 },
    ];
  });
  const { code, stderr } = validate(root);
  assert.equal(code, 0, stderr);
});

test("a point Light with both anchor and at fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.variants[0].lights = [{ ...lamp, at: { x: 10, y: 10 } }]; });
  failsWith(validate(root), fixtureScene, "variants[0].lights[0]", /exactly one of anchor or at/);
});

test("a point Light with neither anchor nor at fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => {
    const { anchor, offset, ...unplaced } = lamp;
    plan.variants[0].lights = [unplaced];
  });
  failsWith(validate(root), fixtureScene, "variants[0].lights[0]", /exactly one of anchor or at/);
});

test("a point Light anchored to a missing Placement fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.variants[1].lights = [{ ...lamp, anchor: "lamp" }]; });
  failsWith(validate(root), fixtureScene, "variants[1].lights[0].anchor", /no Placement lamp/);
});

test("emissiveOff naming a missing Placement fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.variants[1].emissiveOff = ["stars", "city-lights"]; });
  failsWith(validate(root), fixtureScene, "variants[1].emissiveOff[1]", /no Placement city-lights/);
});

test("a Light with an unknown type fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.variants[0].lights = [{ type: "directional", id: "sun", strength: 1, tint: "warm" }]; });
  failsWith(validate(root), fixtureScene, "variants[0].lights[0].type", /./);
});

test("a beam whose corners do not go round a convex quad fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => {
    plan.variants[0].lights = [{ type: "beam", id: "sun", corners: [{ x: 0, y: 0 }, { x: 40, y: 40 }, { x: 40, y: 0 }, { x: 0, y: 40 }], strength: 1, tint: "warm", softness: 2 }];
  });
  failsWith(validate(root), fixtureScene, "variants[0].lights[0].corners", /convex quad/);
});

test("two Lights with the same id in one Variant fail", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.variants[0].lights = [lamp, { ...lamp, anchor: "window" }]; });
  failsWith(validate(root), fixtureScene, "variants[0].lights[1].id", /duplicate Light id lamp/);
});

test("an emissive mask whose size differs from the Element fails", () => {
  const root = makeTree();
  copyFileSync(join(root, "library/elements/sky-stars-night-01.png"), join(root, "library/elements/skyline-night-warm-windows-01.emissive.png"));
  failsWith(validate(root), SKYLINE, "emissiveMask", /emissive mask .* is 32x32, record says 256x128/);
});

test("a record claiming an emissive mask that is missing fails", () => {
  const root = makeTree();
  rmSync(join(root, "library/elements/skyline-night-warm-windows-01.emissive.png"));
  failsWith(validate(root), SKYLINE, "emissiveMask", /emissive mask .*skyline-night-warm-windows-01\.emissive\.png is missing/);
});

test("an emissive mask file the record does not claim fails, and so does a mask with no emissive colours", () => {
  const root = makeTree();
  copyFileSync(join(root, "library/elements/skyline-night-warm-windows-01.emissive.png"), join(root, "library/elements/sky-stars-night-01.emissive.png"));
  failsWith(validate(root), "library/elements/sky-stars-night-01.json", "emissiveMask", /has an emissive mask beside it; set emissiveMask/);
  editJson(root, SKYLINE, (record) => { delete record.emissive; });
  failsWith(validate(root), SKYLINE, "emissiveMask", /needs emissive colours/);
});

test("a Scene with zero Variants fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.variants = []; });
  failsWith(validate(root), fixtureScene, "variants", /at least one Variant/);
});

test("two Variants with the same id fail", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.variants[1].id = plan.variants[0].id; });
  failsWith(validate(root), fixtureScene, "variants[1].id", /duplicate Variant id night-rain/);
});

test("a glow Primitive fails: glow is retired", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.primitives.push({ type: "glow", anchor: "window", offset: { x: 24, y: 24 }, colour: 8 }); });
  failsWith(validate(root), fixtureScene, "primitives[2].type", /./);
});

test("a glow Primitive in a Variant fails too", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.variants[1].primitives = [{ type: "glow", anchor: "window", offset: { x: 24, y: 24 }, colour: 8 }]; });
  failsWith(validate(root), fixtureScene, "variants[1].primitives[0].type", /./);
});

test("a Primitive takes an optional emissive flag", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.primitives[0].emissive = true; plan.primitives[1].emissive = false; });
  const { code, stderr } = validate(root);
  assert.equal(code, 0, stderr);
});

test("a Variant Primitive colour beyond the Palette fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.variants[1].primitives = [{ type: "twinkle", anchor: "skyline", colours: [16] }]; });
  failsWith(validate(root), fixtureScene, "variants[1].primitives[0].colours[0]", /colour index 16 is not in Palette fixture-night-v2/);
});

test("an Element record's emissive colours must be on its Palette", () => {
  const root = makeTree();
  editJson(root, "library/elements/sky-stars-night-01.json", (record) => { record.emissive = [7, 16]; });
  failsWith(validate(root), "library/elements/sky-stars-night-01.json", "emissive[1]", /colour index 16 is not in Palette fixture-night-v2/);
});
const WINDOW = "library/elements/window-wood-transparent-panes-01.json";
const sceneDir = "scenes/fixture-rainy-desk-a1b2";

function failsWith(result: ValidateResult, file: string, path: string, message: RegExp): void {
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.report.ok, false);
  const hit = result.report.errors.find((e: any) => e.file === file && e.path === path && message.test(e.message));
  assert.ok(hit, `expected an error at ${file} ${path} matching ${message}, got ${JSON.stringify(result.report.errors, null, 2)}`);
  assert.match(result.stderr, new RegExp(`${file.replace(/[.]/g, "\\.")}: ${path.replace(/[.[\]]/g, "\\$&") || "\\(root\\)"}: `));
}

test("a foot Placement in a Scene without a Stage fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { delete plan.stage; });
  failsWith(validate(root), fixtureScene, "layers[3].placements[1].foot", /foot .*only with a Stage/);
});

test("a foot outside the floor polygon fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[3].placements[1].foot = { x: 292, y: 150 }; });
  failsWith(validate(root), fixtureScene, "layers[3].placements[1].foot", /foot 292,150 is outside the floor/);
});

test("a foot beside the floor, past the ray from the vanishing point, fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[3].placements[2].foot = { x: 5, y: 190 }; });
  failsWith(validate(root), fixtureScene, "layers[3].placements[2].foot", /outside the floor/);
});

test("a Stage whose vanishing point is outside the canvas fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.stage.vanishingPoint = { x: 400, y: 100 }; });
  failsWith(validate(root), fixtureScene, "stage.vanishingPoint", /outside the 384x240 canvas/);
});

for (const [what, position] of [
  ["both x, y and foot", { x: 10, y: 10, foot: { x: 292, y: 216 } }],
  ["no position", {}],
] as const) {
  test(`a Placement with ${what} fails`, () => {
    const root = makeTree();
    editJson(root, fixtureScene, (plan) => {
      const { x, y, foot, ...rest } = plan.layers[3].placements[1];
      plan.layers[3].placements[1] = { ...rest, ...position };
    });
    failsWith(validate(root), fixtureScene, "layers[3].placements[1]", /exactly one position: x, y or foot/);
  });
}

test("a Placement whose Element is not in the Element library fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[3].placements[0].element = "lamp-brass-desk-01"; });
  failsWith(validate(root), fixtureScene, "layers[3].placements[0].element", /lamp-brass-desk-01 is not in the Element library/);
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
  ["its Palette file fails its schema", (root: string) => editJson(root, PALETTE, (palette) => { palette.colours = []; })],
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
  failsWith(validate(root), CAT, "animation.frames", new RegExp(`is 96x16, record says ${5 * 24}x16`));
});

test("an Element whose Frame strip file is missing fails", () => {
  const root = makeTree();
  rmSync(join(root, "library/elements/cat-tabby-asleep-01.strip.png"));
  failsWith(validate(root), CAT, "animation.frames", /Frame strip .* is missing/);
});

test("an Element PNG whose size does not match the record fails", () => {
  const root = makeTree();
  editJson(root, WINDOW, (record) => { record.width = 56; });
  failsWith(validate(root), WINDOW, "", /Element PNG .* is 48x48, record says 56x48/);
});

test("an animation override on a Placement whose Element has no Frame strip fails a resolved Scene", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[3].placements[0].animation = { fps: 4 }; });
  failsWith(validate(root), fixtureScene, "layers[3].placements[0].animation", /declared resolved but .*has no Frame strip/);
});

test("an animation override waiting on a Frame strip keeps a draft Scene pending", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => {
    plan.status = "draft";
    plan.layers[3].placements[0].animation = { fps: 4 };
  });
  const { code, report } = validate(root);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.equal(report.scenes[0].status, "draft");
  assert.match(report.scenes[0].pending.find((p: any) => p.path === "layers[3].placements[0].animation")?.message ?? "", /has no Frame strip/);
});

test("an explicit frame order past the end of the Frame strip fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[3].placements[2].animation.order = [0, 1, 4]; });
  failsWith(validate(root), fixtureScene, "layers[3].placements[2].animation.order[2]", /frame 4 is beyond the 4-frame strip/);
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
  assert.ok(scene.pending.some((p: any) => p.path === "layers[2].placements[0].generate"));
});

test("a fill Layer with placements fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.layers[0].placements = []; });
  failsWith(validate(root), fixtureScene, "layers[0]", /placements/);
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

const addToVariant = (root: string, sounds: { ambient?: unknown[]; oneshots?: unknown[] }) =>
  editJson(root, fixtureScene, (plan) => { plan.variants[1].soundtrack = sounds; });

test("a Variant's added sounds within the caps validate with the base", () => {
  const root = makeTree();
  addToVariant(root, { ambient: [ambientAt("near"), ambientAt("far")], oneshots: [readJson(root, fixtureScene).soundtrack.oneshots[0]] });
  const { code, report } = validate(root);
  assert.equal(code, 0, JSON.stringify(report.errors));
  assert.equal(report.scenes[0].status, "resolved");
});

test("base plus Variant over the ambient cap fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.soundtrack.ambient = ["near", "mid", "far"].map((d) => ambientAt(d)); });
  addToVariant(root, { ambient: [ambientAt("near"), ambientAt("mid"), ambientAt("far")] });
  failsWith(validate(root), fixtureScene, "variants[1].soundtrack.ambient", /at most 5 ambient per Scene: base plus Variant clear-night has 6/);
});

test("base plus Variant over 2 ambient at one Distance fails", () => {
  const root = makeTree();
  addToVariant(root, { ambient: [ambientAt("mid"), ambientAt("mid")] });
  failsWith(validate(root), fixtureScene, "variants[1].soundtrack.ambient[1]", /at most 2 ambient at Distance mid with Variant clear-night/);
});

test("base plus Variant over the One-shot cap fails", () => {
  const root = makeTree();
  const shot = readJson(root, fixtureScene).soundtrack.oneshots[0];
  addToVariant(root, { oneshots: [shot, shot] });
  failsWith(validate(root), fixtureScene, "variants[1].soundtrack.oneshots", /at most 2 One-shots per Scene: base plus Variant clear-night has 3/);
});

test("a resolved Scene whose Variant sound file is missing beside the plan fails, and a draft one is pending", () => {
  const root = makeTree();
  addToVariant(root, { ambient: [{ ...ambientAt("near"), file: "wind.ogg" }] });
  failsWith(validate(root), fixtureScene, "variants[1].soundtrack.ambient[0].file", /declared resolved but wind\.ogg is missing/);
  editJson(root, fixtureScene, (plan) => { plan.status = "draft"; });
  const { code, report } = validate(root);
  assert.equal(code, 0);
  assert.deepEqual(report.scenes[0].pending.map((p: any) => p.path), ["variants[1].soundtrack.ambient[0].file"]);
});

test("a Variant's generated sound with no Sound library record yet keeps the Scene draft", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.status = "draft"; });
  addToVariant(root, { ambient: [{ source: { kind: "generated", service: "elevenlabs-fal", brief: "wind" }, file: "room.ogg", distance: "near" }] });
  const { report } = validate(root);
  assert.deepEqual(report.scenes[0].pending.map((p: any) => p.path), ["variants[1].soundtrack.ambient[0].source"]);
});

test("an unknown Primitive type fails", () => {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => { plan.primitives.push({ type: "fog" }); });
  failsWith(validate(root), fixtureScene, "primitives[2].type", /./);
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

const localRug = { kind: "prop", brief: "plain grey rug", realSize: { w: 1, h: 0.5 }, tags: ["rug"], finish: "local", generator: "rect", params: { fill: 3 } };
const starsTexture = { kind: "texture", brief: "night sky with stars", tags: ["sky"], size: { w: 64, h: 32 }, generator: "stars", params: { sky: 1, stars: [7, 12] } };

function withGenerate(generate: object, placement = 0, layer = 3): string {
  const root = makeTree();
  editJson(root, fixtureScene, (plan) => {
    plan.status = "draft";
    plan.layers[layer].placements[placement].generate = generate;
  });
  return root;
}

test("a local prop and a texture naming generators the engine has validate as a draft", () => {
  const prop = validate(withGenerate(localRug));
  assert.equal(prop.code, 0, prop.stderr);
  const texture = validate(withGenerate(starsTexture, 0, 1));
  assert.equal(texture.code, 0, texture.stderr);
});

test("a local prop without a generator fails", () => {
  const { generator, ...noGenerator } = localRug;
  failsWith(validate(withGenerate(noGenerator)), fixtureScene, "layers[3].placements[0].generate.generator", /local Finish needs a generator/);
});

test("a local generate naming a generator the engine lacks fails", () => {
  failsWith(validate(withGenerate({ ...localRug, generator: "teapot" })), fixtureScene, "layers[3].placements[0].generate.generator",
    /no generator teapot in the local pixel engine/);
});

test("a local generate whose params the generator rejects fails", () => {
  failsWith(validate(withGenerate({ ...localRug, params: { fill: "beige" } })), fixtureScene, "layers[3].placements[0].generate.params.fill", /./);
});

test("a texture generate block with finish service fails", () => {
  failsWith(validate(withGenerate({ ...starsTexture, finish: "service" }, 0, 1)), fixtureScene, "layers[1].placements[0].generate.finish",
    /Seamless texture is always local/);
});
