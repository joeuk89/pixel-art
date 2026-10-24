import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repo } from "./helpers.ts";

const folder = join(repo, ".claude/skills/director");
const skill = () => readFileSync(join(folder, "SKILL.md"), "utf8");
type Step = { number: number; title: string; text: string };
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

function body(text: string): string {
  const match = text.match(FRONTMATTER);
  assert.ok(match, "SKILL.md starts with frontmatter");
  return text.slice(match[0].length);
}

function steps(text: string): Step[] {
  return body(text)
    .split(/^(?=## )/m)
    .filter((s) => s.startsWith("## "))
    .map((s) => {
      const m = s.match(/^## (\d+)\. (.+)$/m);
      assert.ok(m, `section is not a numbered step: ${s.split("\n")[0]}`);
      return { number: Number(m[1]), title: m[2], text: s };
    });
}

test("SKILL.md declares the director skill in its frontmatter", () => {
  const front = skill().match(FRONTMATTER)?.[1] ?? "";
  assert.match(front, /^name: director$/m);
  assert.match(front, /^description: .{20,}$/m);
});

test("SKILL.md holds only numbered steps, each with a completion criterion", () => {
  const text = skill();
  const preamble = body(text).split(/^## /m)[0];
  assert.deepEqual(
    preamble.split("\n").filter((l) => l.trim() && !l.startsWith("# ")),
    [],
    "nothing but a title before the first step",
  );
  const found = steps(text);
  assert.ok(found.length >= 6);
  found.forEach((s, i) => {
    assert.equal(s.number, i + 1, `step ${s.title} is numbered in order`);
    assert.match(s.text, /^\*\*Done when\*\*/m, `step ${s.number} has a Done when line`);
    assert.doesNotMatch(s.text.slice(3), /^#{1,6} /m, `step ${s.number} has no sub-headings`);
  });
});

function step(title: string): Step {
  const found = steps(skill()).find((s) => s.title === title);
  assert.ok(found, `no step titled ${title}`);
  return found;
}

function firstStep(pattern: RegExp): number {
  const found = steps(skill()).find((s) => pattern.test(s.text));
  assert.ok(found, `no step matches ${pattern}`);
  return found.number;
}

test("the Concept is written before the library is searched", () => {
  assert.equal(firstStep(/^## \d+\. Concept$/m), 1);
  assert.ok(firstStep(/library-search/) > 1);
  assert.doesNotMatch(steps(skill())[0].text, /library-search|derive-canvas|scene-id/);
});

test("canvases are derived before shopping, and validate gates the draft", () => {
  assert.ok(firstStep(/derive-canvas/) < firstStep(/library-search/));
  assert.ok(firstStep(/pipeline\/validate\.ts/) <= firstStep(/library-search/));
});

test("the Plan gate follows shopping and waits for the owner's yes", () => {
  const last = step("Plan gate");
  assert.ok(last.number > firstStep(/library-search/));
  assert.match(last.text, /\*\*Done when\*\* the owner has said yes/);
  for (const item of ["Concept", "Palette", "Scale", "Style anchor", "real size", "reused", "generated", "Primitives", "Soundtrack", "estimated cost", "2,000", "£50"]) {
    assert.ok(last.text.includes(item), `Plan gate brief names ${item}`);
  }
});

test("every file SKILL.md links to exists beside it", () => {
  const links = [...skill().matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 5);
  for (const link of links) assert.ok(existsSync(join(folder, link)), `${link} exists`);
});

function skillFiles(): { name: string; text: string }[] {
  return readdirSync(folder).map((name) => ({ name, text: readFileSync(join(folder, name), "utf8") }));
}

test("SKILL.md points at the code and library that hold the Primitive catalogue and the Palette set", () => {
  const text = skill();
  assert.match(text, /primitiveSchema/);
  assert.match(text, /schema\/index\.ts/);
  assert.match(text, /library\/palettes\//);
});

test("no file in the skill folder lists the whole Primitive catalogue", async () => {
  const { primitiveSchema } = await import("../schema/index.ts");
  const types = primitiveSchema.options.map((o) => o.shape.type.value);
  assert.ok(types.length >= 6);
  for (const { name, text } of skillFiles()) {
    const named = types.filter((t) => new RegExp(`\\b${t}\\b`, "i").test(text));
    assert.notDeepEqual(named, types, `${name} names every Primitive type`);
  }
});

test("no file in the skill folder copies a Palette", () => {
  const palettes = readdirSync(join(repo, "library/palettes")).map((n) => JSON.parse(readFileSync(join(repo, "library/palettes", n), "utf8")));
  for (const { name, text } of skillFiles()) {
    assert.doesNotMatch(text, /#[0-9a-f]{6}\b/i, `${name} holds a hex colour`);
    for (const p of palettes) {
      assert.ok(!text.includes(p.name), `${name} names the house Palette ${p.name}`);
      assert.ok(!text.includes(p.mood), `${name} copies the mood of ${p.name}`);
    }
  }
});

test("no file in the skill folder holds a Scene plan template", () => {
  for (const { name, text } of skillFiles()) {
    assert.doesNotMatch(text, /"schemaVersion"|"layers"\s*:/, `${name} holds a Scene plan skeleton`);
  }
});

test("a proposed new Palette blocks reuse and forces colours to be re-picked once approved", () => {
  const shop = step("Shop");
  const gate = step("Plan gate");
  assert.match(shop.text, /new Palette is proposed, no library Element qualifies for reuse/);
  const done = gate.text.slice(gate.text.indexOf("**Done when**"));
  assert.match(done, /re-pick every `fill` and Primitive colour index against the new Palette/);
  assert.match(done, /new Palette[\s\S]*pipeline\/validate\.ts/);
  assert.match(done, /rejects the new Palette[\s\S]*step 5[\s\S]*house Palette/);
});

test("an owner edit to scale, a realSize or an Element re-derives canvases and re-shops before the brief is shown again", () => {
  const gate = step("Plan gate");
  const edits = gate.text.slice(gate.text.indexOf("Wait for the owner"), gate.text.indexOf("**Done when**"));
  assert.match(edits, /`scale`[\s\S]*`realSize`[\s\S]*Element/);
  assert.match(edits, /`generate` block back on every reused Placement/);
  assert.match(edits, /step 4[\s\S]*step 5/);
  assert.match(edits, /reused Element's size[\s\S]*canvas/);
  assert.match(edits, /pipeline\/validate\.ts[\s\S]*show the brief again/);
});

test("after the Plan gate the skill runs Build Primitives, Generate, Hard checks, Preview and Rejection, in that order", () => {
  const titles = steps(skill()).map((s) => s.title);
  const gate = titles.indexOf("Plan gate");
  assert.deepEqual(titles.slice(gate + 1), ["Build Primitives", "Generate", "Hard checks", "Preview", "Rejection"]);
  assert.doesNotMatch(step("Plan gate").text, /generation is not part of this skill/);
});

test("the Plan gate offers each missing Primitive as build it or use the nearest, and waits for an answer to each", () => {
  const gate = step("Plan gate").text;
  assert.match(gate, /missing Primitive[^\n]*"build it" or "use the nearest"/);
  assert.match(gate.slice(gate.indexOf("**Done when**")), /answered "build it" or "use the nearest" for every missing Primitive/);
});

test("Build Primitives runs one subagent at a time by primitives.md, unattended, ends on a passing npm test and stages without committing", () => {
  const text = step("Build Primitives").text;
  assert.match(text, /\(primitives\.md\)/);
  assert.match(text, /never ask the owner/i);
  assert.match(text, /subagent, one after another/);
  assert.match(text, /stand-in/);
  assert.match(text, /npm test/);
  assert.match(text, /staged/);
  assert.doesNotMatch(text, /git commit/);
  assert.match(step("Preview").text, /Primitive built at step 7/);
});

test("Generate runs unattended in the agreed order and never asks the owner", () => {
  const text = step("Generate").text;
  assert.match(text, /never ask the owner/i);
  const order = ["pipeline/music.ts", "--style-anchor", "up to 8", "generate-strip"].map((s) => text.indexOf(s));
  for (const at of order) assert.ok(at >= 0);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "music and the Style anchor, then batches of up to 8, then strips");
  for (const needle of ["pipeline/budget.ts", "--abandon", "--substitute", "--scene", "rubric.md", "8x"]) assert.ok(text.includes(needle), `Generate names ${needle}`);
});

test("Hard checks render the Poster and stub before check-scene, and a failure stops with the Scene draft", () => {
  const text = step("Hard checks").text;
  const order = ["pipeline/poster.ts", "pipeline/stub.ts", "pipeline/check-scene.ts"].map((s) => text.indexOf(s));
  for (const at of order) assert.ok(at >= 0);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(text, /draft/);
  assert.match(text, /stop/i);
});

test("Preview starts the dev server, runs preview and never commits", () => {
  const text = step("Preview").text;
  assert.match(text, /npm run dev/);
  assert.match(text, /pipeline\/preview\.ts/);
  for (const item of ["preview URL", "staged files", "cost block", "ledger", "commit message"]) assert.ok(text.includes(item), `Preview prints ${item}`);
  assert.match(text, /never commit/i);
});

test("Rejection reopens only the changed Placements under the same Scene id", () => {
  const text = step("Rejection").text;
  assert.match(text, /pipeline\/reopen\.ts/);
  assert.match(text, /same Scene id/);
  assert.match(text, /only/);
  assert.match(text, /step 8[\s\S]*step 9[\s\S]*step 10/);
});
