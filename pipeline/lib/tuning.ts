import { z } from "zod";
import { scenePlanSchema, type Palette, type ScenePlan } from "../../schema/index.ts";

const VARIANT_FIELDS = ["ambient", "lights", "emissiveOff"] as const;

export const tuningSchema = z.strictObject({
  dither: z.boolean(),
  variants: z.array(
    z.strictObject({ id: z.string(), ambient: z.unknown(), lights: z.array(z.unknown()), emissiveOff: z.array(z.unknown()) }),
  ),
});

export type Tuning = z.infer<typeof tuningSchema>;

export function tuningOf(plan: ScenePlan): Tuning {
  return {
    dither: plan.dither,
    variants: plan.variants.map((v) => ({ id: v.id, ambient: v.ambient, lights: v.lights, emissiveOff: v.emissiveOff })),
  };
}

type Span = { start: number; end: number; members?: Map<string, Member>; items?: Span[] };
type Member = { keyStart: number; value: Span };

function scan(text: string): Span {
  let i = 0;
  const space = () => {
    while (/\s/.test(text[i] ?? "")) i++;
  };
  const string = () => {
    const start = i++;
    while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (): Span => {
    space();
    const start = i;
    if (text[i] === "{") {
      const members = new Map<string, Member>();
      i++;
      space();
      while (text[i] !== "}") {
        const keyStart = i;
        const key = string();
        space();
        i++;
        members.set(key, { keyStart, value: value() });
        space();
        if (text[i] === ",") i++;
        space();
      }
      i++;
      return { start, end: i, members };
    }
    if (text[i] === "[") {
      const items: Span[] = [];
      i++;
      space();
      while (text[i] !== "]") {
        items.push(value());
        space();
        if (text[i] === ",") i++;
        space();
      }
      i++;
      return { start, end: i, items };
    }
    if (text[i] === '"') {
      string();
      return { start, end: i };
    }
    while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
    return { start, end: i };
  };
  return value();
}

function inline(value: unknown): string {
  if (Array.isArray(value)) return value.length ? `[${value.map(inline).join(", ")}]` : "[]";
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    return entries.length ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(", ")} }` : "{}";
  }
  return JSON.stringify(value);
}

function indentAt(text: string, at: number): string {
  const lineStart = text.lastIndexOf("\n", at) + 1;
  return text.slice(lineStart).match(/^[ \t]*/)![0];
}

function lightsText(lights: unknown[], indent: string): string {
  if (lights.length === 0) return "[]";
  return `[\n${lights.map((l) => `${indent}  ${inline(l)}`).join(",\n")} ]`;
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = (o: object) => Object.keys(o).filter((k) => (o as any)[k] !== undefined).sort();
    const ka = keys(a);
    return same(ka, keys(b)) && ka.every((k) => same((a as any)[k], (b as any)[k]));
  }
  return a === b;
}

export type Tuned = { text: string; plan: ScenePlan; defaultChanged: boolean };

export class TuningRefused extends Error {}

const describeIssues = (issues: z.ZodError["issues"]) =>
  issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");

// Splices only the changed owned values into the plan's text, so every other byte of scene.json stays as the owner left it.
export function applyTuning(text: string, payload: unknown, palette?: Palette): Tuned {
  const parsedPayload = tuningSchema.safeParse(payload);
  if (!parsedPayload.success) throw new TuningRefused(describeIssues(parsedPayload.error.issues));
  const tuning = parsedPayload.data;
  const raw = JSON.parse(text);
  const ids = raw.variants.map((v: { id: string }) => v.id);
  const sent = tuning.variants.map((v) => v.id);
  if (!same(ids, sent)) throw new TuningRefused(`the Tuner cannot add, remove or reorder Variants: the plan has ${ids.join(", ")}, the Save sent ${sent.join(", ")}`);

  const root = scan(text);
  const edits: { start: number; end: number; text: string }[] = [];
  let defaultChanged = false;

  if (!same(raw.dither ?? false, tuning.dither)) {
    defaultChanged = true;
    const dither = root.members!.get("dither");
    if (dither) edits.push({ start: dither.value.start, end: dither.value.end, text: JSON.stringify(tuning.dither) });
    else {
      const anchor = root.members!.get("scale")!.value;
      edits.push({ start: anchor.end, end: anchor.end, text: `,\n${indentAt(text, anchor.start)}"dither": ${tuning.dither}` });
    }
  }
  const variantSpans = root.members!.get("variants")!.value.items!;
  tuning.variants.forEach((v, vi) => {
    for (const field of VARIANT_FIELDS) {
      if (same(raw.variants[vi][field], v[field])) continue;
      if (vi === 0) defaultChanged = true;
      const member = variantSpans[vi].members!.get(field)!;
      const replacement = field === "lights" ? lightsText(v.lights, indentAt(text, member.keyStart)) : inline(v[field]);
      edits.push({ start: member.value.start, end: member.value.end, text: replacement });
    }
  });

  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);

  const parsed = scenePlanSchema.safeParse(JSON.parse(out));
  if (!parsed.success) throw new TuningRefused(describeIssues(parsed.error.issues));
  if (palette) {
    parsed.data.variants.forEach((v, vi) =>
      v.lights.forEach((light, li) => {
        if (light.type === "point" && light.halo && light.halo.colour >= palette.colours.length) {
          throw new TuningRefused(`variants.${vi}.lights.${li}.halo.colour: colour index ${light.halo.colour} is not in Palette ${palette.name} (${palette.colours.length} colours)`);
        }
      }),
    );
  }
  return { text: out, plan: parsed.data, defaultChanged };
}
