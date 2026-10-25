import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixtures, makeTree, runScript, validate, writeJson } from "./helpers.ts";

const draft = JSON.parse(readFileSync(join(fixtures, "director/penthouse-plan-gate.json"), "utf8"));
const PLAN = `scenes/${draft.id}/scene.json`;
const SPACE = ["--room", "9x2.8x7", "--eye", "1.5"];

function tree(): string {
  const root = makeTree();
  writeJson(root, PLAN, draft);
  return root;
}

const placements = () => draft.layers.flatMap((l: any) => (l.placements ?? []).map((p: any) => ({ ...p, layer: l.name })));
const room = () => draft.layers.find((l: any) => l.kind === "room");

test("the penthouse dry run stops at the Plan gate with a valid v2 draft plan", () => {
  const { code, report, stderr } = validate(tree());
  assert.equal(code, 0, stderr);
  const scene = report.scenes.find((s: any) => s.id === draft.id);
  assert.equal(scene.status, "draft");
  assert.equal(draft.cost.pixellabGenerations, 0, "no spend before the gate");
});

test("its Stage is derive-stage's at 1.25x, because the focal point is the back-wall window", () => {
  const { code, out, stderr } = runScript(makeTree(), "derive-stage", ...SPACE, "--zoom", "1.25");
  assert.equal(code, 0, stderr);
  assert.deepEqual(draft.stage, out.stage);
  assert.equal(draft.scale, out.scale);
});

test("it stages the interior as a room Layer, three to six Layers across every Plane", () => {
  assert.equal(draft.layers.filter((l: any) => l.kind === "room").length, 1);
  assert.ok(draft.layers.length >= 3 && draft.layers.length <= 6);
  assert.deepEqual([...new Set(draft.layers.map((l: any) => l.plane))], ["far", "mid", "near"]);
  assert.ok(room().openings.length >= 1);
});

test("floor props stand on foot positions", () => {
  const standing = placements().filter((p: any) => p.foot).map((p: any) => p.id);
  assert.deepEqual(standing, ["lamp", "armchair", "side-table"]);
});

test("the Backdrop is generated at the size of the Opening it shows through, and placed in it", () => {
  const backdrops = placements().filter((p: any) => p.generate?.kind === "backdrop");
  assert.equal(backdrops.length, 1);
  const [{ x, y, generate }] = backdrops;
  const window = room().openings.find((o: any) => o.surface === "back");
  assert.deepEqual(generate.size, { w: window.w, h: window.h });
  assert.deepEqual({ x, y }, { x: draft.stage.back.x + window.along, y: draft.stage.back.y + window.across });
});

test("one Variant lights the lamp as a warm flickering point Light by the defaults table", async () => {
  const { scaleAt } = await import("../pipeline/lib/perspective.ts");
  assert.equal(draft.variants.length, 1);
  const [night] = draft.variants;
  assert.equal(night.ambient.level, -2.5);
  const lamp = night.lights.find((l: any) => l.anchor === "lamp");
  assert.equal(lamp.type, "point");
  assert.equal(lamp.strength, 2.5);
  assert.equal(lamp.tint, "warm");
  assert.deepEqual(lamp.flicker, { depth: 0.1, rate: 0.8 });
  const foot = placements().find((p: any) => p.id === "lamp").foot;
  assert.ok(Math.abs(lamp.radius - 2.5 * scaleAt(draft.stage, draft.scale, foot.y)) <= 2, `radius ${lamp.radius}`);
  const spill = night.lights.find((l: any) => l.at);
  assert.equal(spill.tint, "cool");
});

test("derive-canvas gives the gate depth-derived canvases, the hero prop at 48 to 96 px and the Finish offer", () => {
  const { code, out, stderr } = runScript(tree(), "derive-canvas", PLAN, "--eligible", "side-table");
  assert.equal(code, 0, stderr);
  const canvas = Object.fromEntries(out.placements.map((p: any) => [p.placement, p.canvas]));
  assert.deepEqual(canvas.lamp, { width: 32, height: 104 });
  assert.deepEqual(canvas.armchair, { width: 68, height: 72 });
  assert.deepEqual(canvas["side-table"], { width: 40, height: 44 });
  assert.deepEqual(canvas.city, { width: 256, height: 148 });
  assert.deepEqual(out.finishOffer.eligible.map((e: any) => [e.placement, e.service]), [["side-table", { generations: 5, usd: 0.024 }]]);
  assert.deepEqual(out.finishOffer.saving, { generations: 5, usd: 0.024, gbp: 0.0185 });
});
