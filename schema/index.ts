import { z } from "zod";

export const SCENE_WIDTH = 384;
export const SCENE_HEIGHT = 240;
export const MAX_AMBIENT_PER_DISTANCE = 2;
export const MAX_AMBIENT_PER_SCENE = 5;
export const MAX_ONESHOTS_PER_SCENE = 2;
export const MAX_PALETTE_COLOURS = 32;
export const MIN_PROP_SIDE = 16;
export const MAX_PROP_SIDE = 256;
export const SIDE_STEP = 4;
export const POSTER_FILE = "poster.png";
export const MUSIC_FILE = "music.mp3";
export const POSTER_OG_FILE = "poster-og.png";
export const POSTER_OG_SCALE = 2;
export const DEFAULT_STAGE_F = 120;

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
export const planeSchema = z.enum(["far", "mid", "near"]);
export type Plane = z.infer<typeof planeSchema>;
export const PLANE_RAMP_OFFSETS: Readonly<Record<Plane, number>> = { far: -0.5, mid: 0, near: -1 };

const gridSide = (max: number) => int.positive().max(max).multipleOf(SIDE_STEP);
const canvasWidth = gridSide(SCENE_WIDTH);
const canvasHeight = gridSide(SCENE_HEIGHT);
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

export const finishSchema = z.enum(["local", "service"]);
export type Finish = z.infer<typeof finishSchema>;
const paramValue = z.union([z.number(), z.string(), z.boolean()]);
const generatorParams = z.record(z.string(), z.union([paramValue, z.array(paramValue)]));

const propGenerate = z
  .strictObject({
    kind: z.literal("prop"),
    brief: z.string().min(1),
    realSize: size,
    tags,
    strip: strip.optional(),
    removeBackground: z.boolean().optional(),
    finish: finishSchema.default("service"),
    generator: slug.optional(),
    params: generatorParams.optional(),
  })
  .superRefine((g, ctx) => {
    if (g.finish === "local") {
      if (g.generator === undefined) ctx.addIssue({ code: "custom", path: ["generator"], message: "a local Finish needs a generator" });
      if (g.params === undefined) ctx.addIssue({ code: "custom", path: ["params"], message: "a local Finish needs params" });
    } else if (g.generator !== undefined || g.params !== undefined) {
      ctx.addIssue({ code: "custom", path: ["finish"], message: "generator and params go with finish: local" });
    }
  });

const generate = z.discriminatedUnion("kind", [
  propGenerate,
  z.strictObject({ kind: z.literal("backdrop"), brief: z.string().min(1), tags, size: z.strictObject({ w: canvasWidth, h: canvasHeight }) }),
  z.strictObject({
    kind: z.literal("texture"),
    brief: z.string().min(1),
    tags,
    size: z.strictObject({ w: canvasWidth, h: canvasHeight }),
    finish: z.literal("local", { error: "a Seamless texture is always local" }).optional(),
    generator: slug,
    params: generatorParams,
  }),
]);

export type Generate = z.infer<typeof generate>;

export const isLocal = (g: Generate) => g.kind === "texture" || (g.kind === "prop" && g.finish === "local");

const stage = z.strictObject({ back: region, vanishingPoint: point, f: z.number().positive() });

const placement = z
  .strictObject({
    id: slug,
    element: elementId,
    x: int.optional(),
    y: int.optional(),
    foot: point.optional(),
    flipX: z.boolean().optional(),
    tileX: z.boolean().optional(),
    animation: placementAnimation.optional(),
    generate: generate.optional(),
  })
  .superRefine((p, ctx) => {
    const xy = p.x !== undefined && p.y !== undefined;
    const positions = (xy ? 1 : 0) + (p.foot ? 1 : 0);
    const partial = (p.x === undefined) !== (p.y === undefined);
    if (positions !== 1 || partial) ctx.addIssue({ code: "custom", path: [], message: "a Placement takes exactly one position: x, y or foot" });
  });

const layer = z.discriminatedUnion("kind", [
  z.strictObject({ name: slug, kind: z.literal("fill"), plane: planeSchema, colour: colourIndex }),
  z.strictObject({
    name: slug,
    kind: z.literal("placements"),
    plane: planeSchema,
    scale: z.number().positive().optional(),
    placements: z.array(placement),
  }),
]);

const colours = z.array(colourIndex).min(1);
const litByDefault = z.boolean().default(false);
const emissiveByDefault = z.boolean().default(true);

export const primitiveSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("rain"),
    emissive: litByDefault,
    anchor: slug.optional(),
    region,
    colours,
    density: int.positive().default(34),
    drift: z.number().default(0.25),
  }),
  z.strictObject({
    type: z.literal("snow"),
    emissive: litByDefault,
    anchor: slug.optional(),
    region,
    colours,
    density: int.positive().default(40),
    drift: z.number().min(0).default(1),
    wind: z.number().default(0),
  }),
  z.strictObject({ type: z.literal("steam"), emissive: emissiveByDefault, anchor: slug, offset: point, colours, count: int.positive().default(14) }),
  z.strictObject({ type: z.literal("twinkle"), emissive: emissiveByDefault, anchor: slug, colours, count: int.positive().default(6) }),
  z.strictObject({
    type: z.literal("blink"),
    emissive: emissiveByDefault,
    anchor: slug,
    swaps: z.array(z.tuple([colourIndex, colourIndex])).min(1),
    rate: z.number().positive().default(0.5),
    longShare: z.number().min(0).max(1).default(0.3),
    longFrames: z
      .tuple([int.positive(), int.positive()])
      .refine(([min, max]) => min <= max, "min must not exceed max")
      .default([4, 9]),
  }),
  // A mote fades in and out through colours, so list them dim to bright.
  z.strictObject({ type: z.literal("dust"), emissive: litByDefault, anchor: slug.optional(), region, colours, count: int.positive().default(12) }),
  z.strictObject({
    type: z.literal("sway"),
    emissive: litByDefault,
    anchor: slug,
    // In Scene coordinates, like every Primitive region; only the anchor's pixels of colours inside it move.
    region,
    colours,
    amplitude: int.positive().default(1),
    rate: z.number().positive().default(0.25),
  }),
  z.strictObject({
    type: z.literal("birds"),
    emissive: litByDefault,
    anchor: slug.optional(),
    region,
    colours,
    count: int.positive().max(7).default(3),
    every: z
      .tuple([z.number().positive(), z.number().positive()])
      .refine(([min, max]) => min <= max, "min must not exceed max")
      .default([12, 30]),
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

export const tintSchema = z.enum(["warm", "cool"]);

const pointLight = z
  .strictObject({
    type: z.literal("point"),
    id: slug,
    anchor: slug.optional(),
    offset: point.optional(),
    at: point.optional(),
    radius: z.number().positive(),
    strength: z.number(),
    tint: tintSchema,
    flicker: z.strictObject({ depth: z.number().min(0).max(1), rate: z.number().positive() }).optional(),
    halo: z.strictObject({ colour: colourIndex, radius: z.number().positive(), strength: z.number().min(0) }).optional(),
  })
  .superRefine((light, ctx) => {
    if ((light.anchor === undefined) === (light.at === undefined)) {
      ctx.addIssue({ code: "custom", path: [], message: "a point Light needs exactly one of anchor or at" });
    } else if (light.offset !== undefined && light.anchor === undefined) {
      ctx.addIssue({ code: "custom", path: ["offset"], message: "offset applies only to a Light with an anchor" });
    }
  });

const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

const beamLight = z
  .strictObject({
    type: z.literal("beam"),
    id: slug,
    corners: z.tuple([point, point, point, point]),
    strength: z.number(),
    tint: tintSchema,
    softness: z.number().min(0),
  })
  .superRefine((beam, ctx) => {
    const turns = beam.corners.map((c, i, all) => Math.sign(cross(c, all[(i + 1) % 4], all[(i + 2) % 4])));
    if (turns.some((t) => t === 0) || !turns.every((t) => t === turns[0])) {
      ctx.addIssue({ code: "custom", path: ["corners"], message: "beam corners must go round a convex quad in order" });
    }
  });

export const lightSchema = z.discriminatedUnion("type", [pointLight, beamLight]);

const variant = z.strictObject({
  id: slug,
  title: z.string().min(1),
  ambient: z.strictObject({ level: z.number(), layers: z.record(z.string(), z.number()).optional() }),
  lights: z.array(lightSchema),
  companionPalette: slug.optional(),
  primitives: z.array(primitiveSchema).optional(),
  soundtrack: z.strictObject({ ambient: z.array(ambientEntry).optional(), oneshots: z.array(oneshotEntry).optional() }).optional(),
  emissiveOff: z.array(slug),
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
    schemaVersion: z.literal(2, { error: (issue) => `schemaVersion ${JSON.stringify(issue.input)} is retired: a Scene plan needs schemaVersion 2` }),
    id: slug,
    title: z.string().min(1),
    prompt: z.string().min(1),
    description: z.string().min(1),
    createdAt: datetime,
    seed: int,
    status: z.enum(["draft", "resolved"]),
    palette: slug,
    scale: z.number().positive(),
    dither: z.boolean().default(false),
    styleAnchor: elementId.nullable(),
    stage: stage.optional(),
    layers: z.array(layer).min(1),
    primitives: z.array(primitiveSchema),
    variants: z.array(variant).min(1, "a Scene needs at least one Variant"),
    soundtrack,
    cost: sceneCost,
  })
  .superRefine((plan, ctx) => {
    const issue = (path: PropertyKey[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const seen = new Set<string>();
    plan.layers.forEach((l, li) =>
      placementsOf(l).forEach((p, pi) => {
        if (seen.has(p.id)) issue(["layers", li, "placements", pi, "id"], `duplicate Placement id ${p.id}`);
        seen.add(p.id);
      }),
    );
    const vp = plan.stage?.vanishingPoint;
    if (vp && (vp.x < 0 || vp.x >= SCENE_WIDTH || vp.y < 0 || vp.y >= SCENE_HEIGHT)) {
      issue(["stage", "vanishingPoint"], `vanishing point ${vp.x},${vp.y} is outside the ${SCENE_WIDTH}x${SCENE_HEIGHT} canvas`);
    }
    if (!plan.stage) {
      plan.layers.forEach((l, li) =>
        placementsOf(l).forEach((p, pi) => {
          if (p.foot) issue(["layers", li, "placements", pi, "foot"], "a foot position is allowed only with a Stage");
        }),
      );
    }
    const names = new Set<string>();
    let deepest = 0;
    plan.layers.forEach((l, li) => {
      if (names.has(l.name)) issue(["layers", li, "name"], `duplicate Layer name ${l.name}`);
      names.add(l.name);
      const depth = planeSchema.options.indexOf(l.plane);
      if (depth < deepest) issue(["layers", li, "plane"], `Layers must appear in Plane order: ${l.plane} after ${planeSchema.options[deepest]}`);
      deepest = Math.max(deepest, depth);
      if (l.kind === "placements" && l.scale !== undefined && l.plane !== "far") issue(["layers", li, "scale"], "only a far Layer may set its own scale");
    });
    const variantIds = new Set<string>();
    plan.variants.forEach((v, vi) => {
      if (variantIds.has(v.id)) issue(["variants", vi, "id"], `duplicate Variant id ${v.id}`);
      variantIds.add(v.id);
      for (const name of Object.keys(v.ambient.layers ?? {})) {
        if (!names.has(name)) issue(["variants", vi, "ambient", "layers", name], `no Layer ${name} in this plan to offset`);
      }
      const lightIds = new Set<string>();
      v.lights.forEach((light, li) => {
        if (lightIds.has(light.id)) issue(["variants", vi, "lights", li, "id"], `duplicate Light id ${light.id}`);
        lightIds.add(light.id);
        if (light.type === "point" && light.anchor !== undefined && !seen.has(light.anchor)) {
          issue(["variants", vi, "lights", li, "anchor"], `no Placement ${light.anchor} in this plan to anchor to`);
        }
      });
      v.emissiveOff.forEach((id, ei) => {
        if (!seen.has(id)) issue(["variants", vi, "emissiveOff", ei], `no Placement ${id} in this plan to switch off`);
      });
      const ambient = v.soundtrack?.ambient ?? [];
      const oneshots = v.soundtrack?.oneshots ?? [];
      const at = ["variants", vi, "soundtrack"];
      const ambientCount = plan.soundtrack.ambient.length + ambient.length;
      if (ambient.length > 0 && ambientCount > MAX_AMBIENT_PER_SCENE) {
        issue([...at, "ambient"], `at most ${MAX_AMBIENT_PER_SCENE} ambient per Scene: base plus Variant ${v.id} has ${ambientCount}`);
      }
      const oneshotCount = plan.soundtrack.oneshots.length + oneshots.length;
      if (oneshots.length > 0 && oneshotCount > MAX_ONESHOTS_PER_SCENE) {
        issue([...at, "oneshots"], `at most ${MAX_ONESHOTS_PER_SCENE} One-shots per Scene: base plus Variant ${v.id} has ${oneshotCount}`);
      }
      for (const distance of distanceSchema.options) {
        let count = plan.soundtrack.ambient.filter((a) => a.distance === distance).length;
        ambient.forEach((a, ai) => {
          if (a.distance !== distance || ++count !== MAX_AMBIENT_PER_DISTANCE + 1) return;
          issue([...at, "ambient", ai], `at most ${MAX_AMBIENT_PER_DISTANCE} ambient at Distance ${distance} with Variant ${v.id}`);
        });
      }
    });
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
  emissive: z.array(colourIndex).optional(),
  emissiveMask: z.literal(true).optional(),
  generator: slug.optional(),
};

const propSide = int.min(MIN_PROP_SIDE).max(MAX_PROP_SIDE).multipleOf(SIDE_STEP);

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
    width: canvasWidth,
    height: canvasHeight,
    transparent: z.literal(false),
    seamless: z.literal(true).optional(),
  }),
  z.strictObject({
    ...elementBase,
    kind: z.literal("texture"),
    width: canvasWidth,
    height: canvasHeight,
    transparent: z.boolean(),
    seamless: z.literal(true),
  }),
]).superRefine((record, ctx) => {
  if (record.service === "local" && record.generator === undefined) {
    ctx.addIssue({ code: "custom", path: ["generator"], message: "an Element the local pixel engine drew names its generator" });
  }
});

const ramp = z.strictObject({ dark: colourIndex, warm: colourIndex, cool: colourIndex });

export const paletteSchema = z
  .strictObject({
    name: slug,
    mood: z.string().min(1),
    colours: z
      .array(z.string().regex(/^#[0-9a-f]{6}$/, "must be a lowercase #rrggbb colour"))
      .min(2)
      .max(MAX_PALETTE_COLOURS),
    ramps: z.array(ramp).optional(),
  })
  .superRefine((palette, ctx) => {
    const { colours, ramps } = palette;
    if (!ramps) return;
    if (ramps.length !== colours.length) {
      ctx.addIssue({ code: "custom", path: ["ramps"], message: `one ramp per colour: ${colours.length} colours, ${ramps.length} ramps` });
    }
    ramps.forEach((r, i) => {
      for (const step of ["dark", "warm", "cool"] as const) {
        if (r[step] >= colours.length) ctx.addIssue({ code: "custom", path: ["ramps", i, step], message: `colour index ${r[step]} is not in this Palette` });
      }
    });
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
export type Layer = z.infer<typeof layer>;
export type Variant = z.infer<typeof variant>;
export type Light = z.infer<typeof lightSchema>;
export type Tint = z.infer<typeof tintSchema>;
export type Stage = z.infer<typeof stage>;
export type Placement = z.infer<typeof placement>;
export type Primitive = z.infer<typeof primitiveSchema>;
export type ElementRecord = z.infer<typeof elementRecordSchema>;
export type Palette = z.infer<typeof paletteSchema>;
export type AmbientLoopRecord = z.infer<typeof ambientLoopRecordSchema>;
export type GalleryEntry = Pick<ScenePlan, "id" | "title" | "createdAt" | "description">;

export function placementsOf(layer: Layer): Placement[] {
  return layer.kind === "placements" ? layer.placements : [];
}

export function allPlacements(plan: Pick<ScenePlan, "layers">): Placement[] {
  return plan.layers.flatMap(placementsOf);
}

type SoundEntry = ScenePlan["soundtrack"]["ambient"][number] | ScenePlan["soundtrack"]["oneshots"][number];

export function sceneSounds(plan: Pick<ScenePlan, "soundtrack" | "variants">): { entry: SoundEntry; at: string }[] {
  const listed = (prefix: string, sounds: { ambient?: readonly SoundEntry[]; oneshots?: readonly SoundEntry[] }) => [
    ...(sounds.ambient ?? []).map((entry, i) => ({ entry, at: `${prefix}soundtrack.ambient[${i}]` })),
    ...(sounds.oneshots ?? []).map((entry, i) => ({ entry, at: `${prefix}soundtrack.oneshots[${i}]` })),
  ];
  return [
    ...listed("", plan.soundtrack),
    ...plan.variants.flatMap((v, vi) => (v.soundtrack ? listed(`variants[${vi}].`, v.soundtrack) : [])),
  ];
}
