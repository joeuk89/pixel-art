import { after, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { build } from "esbuild";
import { fixtureScene, readJson, repo, runScript, writeJson } from "./helpers.ts";
import { git, startTuner, stopTuners, tunerTree } from "./tuner.ts";

const id = "fixture-rainy-desk-a1b2";

after(stopTuners);

async function save(url: string, body: unknown): Promise<{ status: number; out: any }> {
  const response = await fetch(new URL("save", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, out: await response.json() };
}

const tuningOf = (plan: any) => ({
  dither: plan.dither,
  variants: plan.variants.map((v: any) => ({ id: v.id, ambient: v.ambient, lights: v.lights, emissiveOff: v.emissiveOff })),
});

const between = (text: string, from: string, to: string) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `no text between ${from} and ${to}`);
  return text.slice(start, end);
};

test("a lighting-only Save replaces the Variant lighting fields and dither and leaves every other byte of the plan as it was", async () => {
  const root = tunerTree();
  const before = readFileSync(join(root, fixtureScene), "utf8");
  const url = await startTuner(root);
  const tuning = tuningOf(readJson(root, fixtureScene));
  tuning.dither = true;
  tuning.variants[0].ambient = { level: -2, layers: { sky: -1 } };
  tuning.variants[0].lights[0].strength = 2;
  tuning.variants[0].emissiveOff = ["skyline"];

  const { status, out } = await save(url, tuning);
  assert.equal(status, 200, JSON.stringify(out));
  const after = readFileSync(join(root, fixtureScene), "utf8");
  const plan = JSON.parse(after);
  assert.equal(plan.dither, true);
  assert.deepEqual(plan.variants[0].ambient, { level: -2, layers: { sky: -1 } });
  assert.equal(plan.variants[0].lights[0].strength, 2);
  assert.deepEqual(plan.variants[0].lights.slice(1), JSON.parse(before).variants[0].lights.slice(1));
  assert.deepEqual(plan.variants[0].emissiveOff, ["skyline"]);

  assert.equal(after.slice(0, after.indexOf('"dither"')), before.slice(0, before.indexOf('"dither"')));
  assert.equal(between(after, '"styleAnchor"', '"ambient"'), between(before, '"styleAnchor"', '"ambient"'));
  assert.equal(after.slice(after.indexOf('{ "id": "clear-night"')), before.slice(before.indexOf('{ "id": "clear-night"')));
});

const staged = (root: string) => git(root, "diff", "--cached", "--name-only").split("\n").filter(Boolean);

test("an invalid Save is refused with the validation message and writes nothing", async () => {
  const root = tunerTree();
  const before = readFileSync(join(root, fixtureScene));
  const poster = readFileSync(join(root, `scenes/${id}/poster.png`));
  const url = await startTuner(root);
  const tuning = tuningOf(readJson(root, fixtureScene));
  tuning.variants[0].lights[1].anchor = "window";

  const { status, out } = await save(url, tuning);
  assert.equal(status, 400);
  assert.equal(out.ok, false);
  assert.match(out.error, /a point Light needs exactly one of anchor or at/);
  assert.deepEqual(readFileSync(join(root, fixtureScene)), before);
  assert.deepEqual(readFileSync(join(root, `scenes/${id}/poster.png`)), poster);
  assert.deepEqual(staged(root), []);
});

test("a Halo colour outside the Palette is refused", async () => {
  const root = tunerTree();
  const before = readFileSync(join(root, fixtureScene));
  const url = await startTuner(root);
  const tuning = tuningOf(readJson(root, fixtureScene));
  tuning.variants[0].lights[0].halo.colour = 31;

  const { status, out } = await save(url, tuning);
  assert.equal(status, 400);
  assert.match(out.error, /halo\.colour: colour index 31 is not in Palette fixture-night-v2/);
  assert.deepEqual(readFileSync(join(root, fixtureScene)), before);
});

test("a Save cannot add or drop a Variant", async () => {
  const root = tunerTree();
  const before = readFileSync(join(root, fixtureScene));
  const url = await startTuner(root);
  const tuning = tuningOf(readJson(root, fixtureScene));
  tuning.variants.pop();

  const { status, out } = await save(url, tuning);
  assert.equal(status, 400);
  assert.match(out.error, /cannot add, remove or reorder Variants/);
  assert.deepEqual(readFileSync(join(root, fixtureScene)), before);
});

const posterPath = (root: string) => join(root, `scenes/${id}/poster.png`);
const old = new Date("2020-01-01T00:00:00Z");

test("a Save that changes the default Variant renders the Poster again under the new lighting", async () => {
  const root = tunerTree();
  const poster = readFileSync(posterPath(root));
  utimesSync(posterPath(root), old, old);
  const url = await startTuner(root);
  const tuning = tuningOf(readJson(root, fixtureScene));
  tuning.variants[0].ambient.level = -1;

  const { status, out } = await save(url, tuning);
  assert.equal(status, 200, JSON.stringify(out));
  assert.equal(out.poster, true);
  assert.notDeepEqual(readFileSync(posterPath(root)), poster);
  assert.ok(statSync(posterPath(root)).mtimeMs > old.getTime());
});

test("a Save that changes only a second Variant leaves the Poster alone", async () => {
  const root = tunerTree();
  utimesSync(posterPath(root), old, old);
  const url = await startTuner(root);
  const tuning = tuningOf(readJson(root, fixtureScene));
  tuning.variants[1].ambient.level = -1;

  const { status, out } = await save(url, tuning);
  assert.equal(status, 200, JSON.stringify(out));
  assert.equal(out.poster, false);
  assert.equal(statSync(posterPath(root)).mtimeMs, old.getTime());
  assert.equal(readJson(root, fixtureScene).variants[1].ambient.level, -1);
});

test("preview runs after every Save: the draft Scene is resolved and its files staged, never committed", async () => {
  const root = tunerTree();
  const plan = readJson(root, fixtureScene);
  plan.status = "draft";
  writeJson(root, fixtureScene, plan);
  git(root, "commit", "-qam", "draft");
  const url = await startTuner(root);
  const tuning = tuningOf(plan);
  tuning.variants[1].emissiveOff = [];

  const { status, out } = await save(url, tuning);
  assert.equal(status, 200, JSON.stringify(out));
  assert.equal(out.ok, true);
  assert.equal(out.status, "resolved");
  assert.equal(readJson(root, fixtureScene).status, "resolved");
  assert.ok(staged(root).includes(`scenes/${id}/scene.json`));
  assert.equal(git(root, "rev-list", "--count", "HEAD").trim(), "2");
});

test("when a preview check fails the Scene goes back to draft and the Save names the check", async () => {
  const root = tunerTree("fail");
  const url = await startTuner(root);
  const tuning = tuningOf(readJson(root, fixtureScene));
  tuning.variants[0].lights[0].radius = 110;

  const { status, out } = await save(url, tuning);
  assert.equal(status, 200, JSON.stringify(out));
  assert.equal(out.ok, false);
  assert.deepEqual(out.preview.failed, ["tests"]);
  assert.equal(out.status, "draft");
  assert.equal(readJson(root, fixtureScene).status, "draft");
  assert.equal(readJson(root, fixtureScene).variants[0].lights[0].radius, 110);
  assert.deepEqual(staged(root), []);
});

test("adding and removing a Light round-trips through Save", async () => {
  const root = tunerTree();
  const url = await startTuner(root);
  const tuning = tuningOf(readJson(root, fixtureScene));
  const added = { type: "point", id: "moon", at: { x: 40, y: 20 }, radius: 60, strength: 1, tint: "cool" };
  tuning.variants[0].lights = [tuning.variants[0].lights[0], tuning.variants[0].lights[2], added];

  const { status, out } = await save(url, tuning);
  assert.equal(status, 200, JSON.stringify(out));
  const served = await (await fetch(new URL("scene.json", url))).json();
  for (const plan of [readJson(root, fixtureScene), served]) {
    assert.deepEqual(plan.variants[0].lights.map((l: any) => l.id), ["lamp", "moonbeam", "moon"]);
    assert.deepEqual(plan.variants[0].lights[2], added);
  }

  tuning.variants[0].lights = tuning.variants[0].lights.slice(0, 2);
  assert.equal((await save(url, tuning)).status, 200);
  assert.deepEqual(readJson(root, fixtureScene).variants[0].lights.map((l: any) => l.id), ["lamp", "moonbeam"]);
});

test("the Viewer bundle takes nothing from the Tuner", async () => {
  const bundled = await build({ entryPoints: [join(repo, "viewer/main.ts")], bundle: true, write: false, metafile: true, absWorkingDir: repo, logLevel: "silent" });
  const inputs = Object.keys(bundled.metafile.inputs);
  assert.ok(inputs.some((path) => path.startsWith("viewer/")), "the metafile lists no Viewer module");
  assert.deepEqual(inputs.filter((path) => path.startsWith("pipeline/")), []);
});

test("the assembled dist/ holds no Tuner file after the Tuner has run", async () => {
  const root = tunerTree();
  await startTuner(root);
  assert.ok(existsSync(join(root, "scratch/tuner/tuner.js")), "the Tuner did not bundle its page into scratch");
  cpSync(join(repo, "index.html"), join(root, "index.html"));
  writeFileSync(join(root, "viewer.js"), "console.log('viewer');\n");
  writeFileSync(join(root, "NOTICE.md"), "# Notice\n");
  const assembled = runScript(root, "assemble");
  assert.equal(assembled.code, 0, assembled.stderr);

  const dist = join(root, "dist");
  const published = readdirSync(dist, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => relative(dist, join(e.parentPath, e.name)));
  assert.ok(published.includes(`scenes/${id}/scene.json`));
  assert.deepEqual(published.filter((path) => /tune|scratch/i.test(path)), []);
  const tuner = readFileSync(join(root, "scratch/tuner/tuner.js"), "utf8");
  for (const path of published.filter((p) => p.endsWith(".js"))) assert.notEqual(readFileSync(join(dist, path), "utf8"), tuner, path);
});
