import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repo } from "./helpers.ts";

const folder = join(repo, ".claude/skills/director");
const skill = () => readFileSync(join(folder, "SKILL.md"), "utf8");

function body(text: string): string {
  const match = text.match(/^---\n[\s\S]*?\n---\n/);
  assert.ok(match, "SKILL.md starts with frontmatter");
  return text.slice(match[0].length);
}

function steps(text: string): { number: number; title: string; text: string }[] {
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
  const front = skill().match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
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
  const last = steps(skill()).find((s) => s.title === "Plan gate");
  assert.ok(last);
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
