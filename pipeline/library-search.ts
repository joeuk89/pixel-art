import { parseArgs } from "node:util";
import { main } from "./lib/cli.ts";
import { finishSchema, type ElementRecord, type Finish } from "../schema/index.ts";
import { readElements, readPalettes, readSounds } from "./lib/library.ts";

type Field = "subject" | "tags" | "brief";
const FIELDS: Field[] = ["subject", "tags", "brief"];

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function sameWord(a: string, b: string): boolean {
  return a === b || a === `${b}s` || b === `${a}s`;
}

function hits(words: string[], text: string): number {
  const ts = tokens(text);
  return words.filter((w) => ts.some((t) => sameWord(t, w))).length;
}

type Searchable = { id: string; subject: string; tags: string[]; brief?: string };

function rank<R extends Searchable>(records: R[], words: string[], first: (record: R) => boolean = () => false) {
  const scored = records.map((record) => {
    const score: Record<Field, number> = {
      subject: hits(words, record.subject),
      tags: hits(words, record.tags.join(" ")),
      brief: hits(words, record.brief ?? ""),
    };
    return { record, score, matched: FIELDS.filter((f) => score[f] > 0) };
  });
  return scored
    .filter((s) => words.length === 0 || s.matched.length > 0)
    .sort((a, b) =>
      Number(first(b.record)) - Number(first(a.record)) ||
      b.score.subject - a.score.subject || b.score.tags - a.score.tags || b.score.brief - a.score.brief || a.record.id.localeCompare(b.record.id),
    );
}

const finishOf = (e: ElementRecord): Finish => (e.service === "local" ? "local" : "service");

// v2 Palettes are copies of v1 ones with Ramps added, so a Palette is matched by its colours rather than its name.
function sameColours(name: string): Set<string> {
  const palettes = readPalettes();
  const asked = palettes.find((p) => p.name === name);
  if (!asked) throw new Error(`no Palette ${name} in library/palettes`);
  const key = asked.colours.join(",");
  return new Set(palettes.filter((p) => p.colours.join(",") === key).map((p) => p.name));
}

function parse() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: { palette: { type: "string" }, size: { type: "string" }, finish: { type: "string" }, sounds: { type: "boolean" } },
    });
  } catch (e) {
    const message = (e as Error).message;
    const unknown = message.match(/Unknown option '(--?[^']+)'/);
    if (unknown) throw new Error(`unknown option ${unknown[1]}`);
    const missing = message.match(/Option '(--[a-z]+)[^']*' argument missing/);
    if (missing) throw new Error(`${missing[1]} needs a value`);
    throw e;
  }
}

main(() => {
  const { values, positionals } = parse();
  const words = positionals.flatMap(tokens);
  const { palette, size, sounds, finish } = values;
  if (words.length === 0 && palette === undefined && size === undefined) {
    throw new Error("usage: library-search <words...> [--palette name] [--size WxH] [--finish local|service] [--sounds]");
  }
  const query = { words, palette: palette ?? null, size: size ?? null, finish: finish ?? null, sounds: sounds ?? false };

  if (sounds) {
    if (palette !== undefined || size !== undefined || finish !== undefined) throw new Error("--sounds does not take --palette, --size or --finish");
    const results = rank(readSounds(), words).map(({ record: r, matched }) => ({
      id: r.id, kind: r.kind, subject: r.subject, tags: r.tags, distance: r.distance, matched,
    }));
    return { query, results };
  }

  if (size !== undefined && !/^\d+x\d+$/.test(size)) throw new Error("--size must be WxH, for example 48x48");
  if (finish !== undefined && !finishSchema.safeParse(finish).success) throw new Error("--finish must be local or service");
  const palettes = palette === undefined ? null : sameColours(palette);
  const elements = readElements().filter(
    (e) => (palettes === null || palettes.has(e.palette)) && (size === undefined || `${e.width}x${e.height}` === size),
  );
  const results = rank(elements, words, (e) => finishOf(e) === finish).map(({ record: e, matched }) => ({
    id: e.id,
    kind: e.kind,
    subject: e.subject,
    tags: e.tags,
    palette: e.palette,
    size: `${e.width}x${e.height}`,
    hasStrip: e.kind === "prop" && e.animation !== undefined,
    finish: finishOf(e),
    matched,
  }));
  return { query, results };
});
