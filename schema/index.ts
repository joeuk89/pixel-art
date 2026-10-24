import { z } from "zod";

export const SCENE_WIDTH = 192;
export const SCENE_HEIGHT = 120;
export const MAX_AMBIENT_PER_DISTANCE = 2;
export const MAX_AMBIENT_PER_SCENE = 5;
export const MAX_ONESHOTS_PER_SCENE = 2;
export const MAX_PALETTE_COLOURS = 32;
export const BACKDROP_WIDTH = 128;
export const BACKDROP_HEIGHT = 64;
export const POSTER_FILE = "poster.png";
export const MUSIC_FILE = "music.mp3";
export const POSTER_OG_FILE = "poster-og.png";

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase slug");
const elementId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)+-\d{2,}$/, "must be <subject>-<descriptors>-<nn>");
const int = z.number().int();
const colourIndex = int.min(0).max(MAX_PALETTE_COLOURS - 1);
const point = z.strictObject({ x: int, y: int });
const region = z.strictObject({ x: int, y: int, w: int.positive(), h: int.positive() });
const size = z.strictObject({ w: z.number().positive(), h: z.number().positive() });
const datetime = z.iso.datetime();
const tags = z.array(z.string().min(1));

export const distanceSchema = z.enum(["near", "mid", "far"]);
export const stripServiceSchema = z.enum(["pixellab", "retro-diffusion"]);

export const frameOrderSchema = z.union([
  z.enum(["cycle", "pingpong"]),
  z.array(int.min(0)).min(1).max(64),
]);

const placementAnimation = z.strictObject({
  fps: z.number().min(1).max(10).optional(),
  order: frameOrderSchema.optional(),
  enabled: z.boolean().optional(),
});

export type StripService = z.infer<typeof stripServiceSchema>;
export const DEFAULT_STRIP_FRAMES: Record<StripService, number> = { pixellab: 5, "retro-diffusion": 8 };
// PixelLab animate v3 takes an even frame_count from 4 to 16 and returns frame_count + 1 images.
export const isPixelLabFrames = (frames: number) => Number.isInteger(frames) && frames % 2 === 1 && frames >= 5 && frames <= 15;

const strip = z
  .strictObject({
    service: stripServiceSchema.default("pixellab"),
    frames: int.min(2).max(16).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.service === "pixellab" && s.frames !== undefined && !isPixelLabFrames(s.frames)) {
      ctx.addIssue({ code: "custom", path: ["frames"], message: `frames for pixellab must be an odd number from 5 to 15, got ${s.frames}` });
    }
  })
  .transform((s) => ({ service: s.service, frames: s.frames ?? DEFAULT_STRIP_FRAMES[s.service] }));

const generate = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("prop"), brief: z.string().min(1), realSize: size, tags, strip: strip.optional() }),
  z.strictObject({ kind: z.literal("backdrop"), brief: z.string().min(1), tags }),
]);

const placement = z.strictObject({
  id: slug,
  element: elementId,
  x: int,
  y: int,
  flipX: z.boolean().optional(),
  tileX: z.boolean().optional(),
  animation: placementAnimation.optional(),
  generate: generate.optional(),
});

const layer = z
  .strictObject({ name: z.string().min(1), fill: colourIndex.optional(), placements: z.array(placement).optional() })
  .refine((l) => (l.fill === undefined) !== (l.placements === undefined), {
    message: "a layer has either fill or placements, never both",
  });

const colours = z.array(colourIndex).min(1);

export const primitiveSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("rain"),
    anchor: slug.optional(),
    region,
    colours,
    density: int.positive().default(34),
    drift: z.number().default(0.25),
  }),
  z.strictObject({
    type: z.literal("snow"),
    anchor: slug.optional(),
    region,
    colours,
    density: int.positive().default(40),
    drift: z.number().min(0).default(1),
    wind: z.number().default(0),
  }),
  z.strictObject({
    type: z.literal("glow"),
    anchor: slug,
    offset: point,
    colour: colourIndex,
    radius: int.positive().default(28),
    flicker: z.number().min(0).max(1).default(0.3),
    pool: z.strictObject({ y: int, colour: colourIndex }).optional(),
  }),
  z.strictObject({ type: z.literal("steam"), anchor: slug, offset: point, colours, count: int.positive().default(14) }),
  z.strictObject({ type: z.literal("twinkle"), anchor: slug, colours, count: int.positive().default(6) }),
  z.strictObject({
    type: z.literal("blink"),
    anchor: slug,
    swaps: z.array(z.tuple([colourIndex, colourIndex])).min(1),
    rate: z.number().positive().default(0.5),
    longShare: z.number().min(0).max(1).default(0.3),
    longFrames: z
      .tuple([int.positive(), int.positive()])
      .refine(([min, max]) => min <= max, "min must not exceed max")
      .default([4, 9]),
  }),
]);

const soundSource = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("curated"), id: slug }),
  z.strictObject({ kind: z.literal("generated"), service: z.string().min(1), brief: z.string().min(1), id: slug.optional() }),
]);

const fileName = z.string().regex(/^[^/\\]+$/, "must be a file name beside the plan");
const gain = z.number().min(0);

const ambientEntry = z.strictObject({ source: soundSource, file: fileName, distance: distanceSchema, gain: gain.optional() });
const oneshotEntry = z.strictObject({
  source: soundSource,
  file: fileName,
  distance: distanceSchema,
  gain: gain.optional(),
  every: z.tuple([z.number().positive(), z.number().positive()]).refine(([min, max]) => min <= max, "min must not exceed max"),
});

const music = z.strictObject({
  brief: z.string().min(1),
  service: z.string().min(1),
  file: fileName.optional(),
  loopStart: z.number().min(0).optional(),
  loopEnd: z.number().positive().optional(),
  seam: z.strictObject({ seamJump: z.number().min(0), maxInnerJump: z.number().min(0) }).optional(),
  gain: gain.default(0.6),
});

const soundtrack = z
  .strictObject({
    music,
    ambient: z.array(ambientEntry).max(MAX_AMBIENT_PER_SCENE, `at most ${MAX_AMBIENT_PER_SCENE} ambient per Scene`),
    oneshots: z.array(oneshotEntry).max(MAX_ONESHOTS_PER_SCENE, `at most ${MAX_ONESHOTS_PER_SCENE} One-shots per Scene`),
  })
  .superRefine((s, ctx) => {
    for (const distance of distanceSchema.options) {
      const at = s.ambient.flatMap((a, i) => (a.distance === distance ? [i] : []));
      if (at.length > MAX_AMBIENT_PER_DISTANCE) {
        ctx.addIssue({
          code: "custom",
          path: ["ambient", at[MAX_AMBIENT_PER_DISTANCE]],
          message: `at most ${MAX_AMBIENT_PER_DISTANCE} ambient at Distance ${distance}`,
        });
      }
    }
  });

const sceneCost = z.strictObject({
  pixellabGenerations: int.min(0),
  meteredUsd: z.record(z.string(), z.number().min(0)),
  attemptsAbandoned: int.min(0),
  approvedOverage: z
    .strictObject({ reason: z.string().min(1), pixellabGenerations: int.min(0).optional(), meteredUsd: z.number().min(0).optional() })
    .nullable(),
});

export const scenePlanSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: slug,
    title: z.string().min(1),
    prompt: z.string().min(1),
    createdAt: datetime,
    seed: int,
    status: z.enum(["draft", "resolved"]),
    palette: slug,
    scale: z.number().positive(),
    styleAnchor: elementId.nullable(),
    layers: z.array(layer).min(1),
    primitives: z.array(primitiveSchema),
    soundtrack,
    cost: sceneCost,
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    plan.layers.forEach((l, li) =>
      l.placements?.forEach((p, pi) => {
        if (seen.has(p.id)) ctx.addIssue({ code: "custom", path: ["layers", li, "placements", pi, "id"], message: `duplicate Placement id ${p.id}` });
        seen.add(p.id);
      }),
    );
  });

const checks = z.looseObject({ attempt: int.min(1), passed: z.array(z.string()), warnings: z.array(z.string()) });
const elementCost = z.strictObject({ pixellabGenerations: int.min(0), meteredUsd: z.number().min(0) });

const elementAnimation = z.strictObject({
  frames: int.min(2).max(16),
  fps: z.number().min(1).max(10).default(6),
  order: frameOrderSchema.default("cycle"),
  service: stripServiceSchema,
  model: z.string().min(1),
  prompt: z.string().min(1),
  seed: int.nullable(),
  params: z.record(z.string(), z.unknown()),
  snappedTo: slug,
  offPaletteBefore: z.number().min(0).max(1),
  cost: elementCost,
  checks,
});

const elementBase = {
  id: elementId,
  subject: z.string().min(1),
  tags,
  brief: z.string().min(1),
  prompt: z.string().min(1),
  service: z.string().min(1),
  model: z.string().min(1),
  params: z.record(z.string(), z.unknown()),
  seed: int.nullable(),
  palette: slug,
  styleAnchor: elementId.nullable(),
  createdAt: datetime,
  firstScene: slug.nullable(),
  cost: elementCost,
  checks,
};

const propSide = int.min(16).max(128).multipleOf(4);

export const elementRecordSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...elementBase,
    kind: z.literal("prop"),
    width: propSide,
    height: propSide,
    realSize: size,
    transparent: z.literal(true),
    animation: elementAnimation.optional(),
  }),
  z.strictObject({
    ...elementBase,
    kind: z.literal("backdrop"),
    width: z.literal(BACKDROP_WIDTH),
    height: z.literal(BACKDROP_HEIGHT),
    transparent: z.literal(false),
  }),
]);

export const paletteSchema = z.strictObject({
  name: slug,
  mood: z.string().min(1),
  colours: z
    .array(z.string().regex(/^#[0-9a-f]{6}$/, "must be a lowercase #rrggbb colour"))
    .min(2)
    .max(MAX_PALETTE_COLOURS),
});

export const ambientLoopRecordSchema = z.strictObject({
  id: slug,
  kind: z.enum(["loop", "oneshot"]),
  distance: z.array(distanceSchema).min(1),
  subject: z.string().min(1),
  tags,
  source: z.string().min(1),
  sourceId: z.union([int, z.string().min(1)]),
  sourceUrl: z.url(),
  sourceName: z.string().min(1),
  author: z.string().min(1),
  licence: z.string().min(1),
  licenceUrl: z.url(),
  attribution: z.string().min(1),
  file: fileName,
  durationSec: z.number().positive(),
  sampleRate: int.positive(),
  channels: int.positive(),
  processing: z.looseObject({ method: z.string().min(1) }),
  fetchedAt: z.string().min(1),
  brief: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
});

export type ScenePlan = z.infer<typeof scenePlanSchema>;
export type Layer = ScenePlan["layers"][number];
export type Placement = z.infer<typeof placement>;
export type Primitive = z.infer<typeof primitiveSchema>;
export type ElementRecord = z.infer<typeof elementRecordSchema>;
export type Palette = z.infer<typeof paletteSchema>;
export type AmbientLoopRecord = z.infer<typeof ambientLoopRecordSchema>;
export type GalleryEntry = Pick<ScenePlan, "id" | "title" | "createdAt" | "prompt">;
