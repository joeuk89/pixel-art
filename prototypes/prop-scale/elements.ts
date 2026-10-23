// The study Scene from prototypes/style-lock, regenerated at Scale 40 px/m (#26). Every prop is generated at the
// size it is drawn. `native` marks a PixelLab native canvas; the rest are custom 4 px-step sizes (beta).
export type Spec = { id: string; subject: string; brief: string; w: number; h: number; native: boolean; realSize: string };

const native = (id: string, subject: string, brief: string, w: number, h: number, realSize: string): Spec => ({ id, subject, brief, w, h, native: true, realSize });
const custom = (id: string, subject: string, brief: string, w: number, h: number, realSize: string): Spec => ({ id, subject, brief, w, h, native: false, realSize });

const BRIEF = {
  bookshelf: "a tall wooden bookshelf filled with books of different heights and colours, seen straight on",
  sofa: "a long three-seat sofa in worn green fabric with a knitted blanket over one arm and two cushions, seen from the side",
  desk: "a long wooden writing desk with two drawers, empty top, seen from the front",
  armchair: "a worn green armchair with a knitted blanket draped over one arm, seen from the side",
  lamp: "a small desk lamp with a warm yellow conical shade on a brass stem, switched on",
  plant: "a leafy potted plant in a terracotta pot, seen from the side",
  cat: "a sleeping ginger cat curled up, eyes closed, tail tucked around its body, seen from the side",
  clock: "a round wall clock with a wooden frame and cream face, seen straight on",
  radio: "a vintage wooden tabletop radio with a round dial and fabric speaker grille, seen from the front",
  mug: "a ceramic mug of coffee with a patterned band, seen from the side",
};

// The main set: one canvas per prop, as the #26 rounding rule would pick it.
export const PROPS: Spec[] = [
  native("sofa-128", "sofa", BRIEF.sofa, 128, 128, "2.6 x 1.0 m"),
  native("bookshelf-96", "bookshelf", BRIEF.bookshelf, 96, 96, "1.0 x 2.3 m"),
  native("desk-96x64", "desk", BRIEF.desk, 96, 64, "2.2 x 0.75 m"),
  native("armchair-48", "armchair", BRIEF.armchair, 48, 48, "1.0 x 1.0 m"),
  native("lamp-32", "lamp", BRIEF.lamp, 32, 32, "0.5 m"),
  native("plant-32", "plant", BRIEF.plant, 32, 32, "0.7 m"),
  custom("cat-32x24", "cat", BRIEF.cat, 32, 24, "0.8 x 0.6 m"),
  native("clock-24", "clock", BRIEF.clock, 24, 24, "0.5 m"),
  native("radio-24", "radio", BRIEF.radio, 24, 24, "0.5 m"),
  native("mug-16", "mug", BRIEF.mug, 16, 16, "0.1 m (floor)"),
];

// Custom sizes next to their native neighbours, to judge whether the pipeline may use the 4 px steps.
export const CUSTOMS: Spec[] = [
  custom("armchair-40", "armchair", BRIEF.armchair, 40, 40, "custom vs 48"),
  custom("plant-36", "plant", BRIEF.plant, 36, 36, "custom vs 32"),
  custom("lamp-28", "lamp", BRIEF.lamp, 28, 28, "custom vs 32"),
  native("cat-24", "cat", BRIEF.cat, 24, 24, "native vs 32x24"),
  custom("clock-20", "clock", BRIEF.clock, 20, 20, "custom vs 24"),
  custom("mug-20", "mug", BRIEF.mug, 20, 20, "custom vs 16"),
  custom("desk-88x32", "desk", BRIEF.desk, 88, 32, "custom vs 96x64"),
];

export const ALL = [...PROPS, ...CUSTOMS];
export const ANCHOR = { id: "anchor-window", file: "out/raw/anchor-window.png", w: 64, h: 64 };

// Conditions. Pro Flash rejects a style_image larger than the target canvas ("Style image must fit the native
// canvas"), so targets under 64 px cannot take the anchor as-is. `style`: anchor as-is, targets of at least 64x64.
// `crop`: anchor centre-cropped to the target box. `shrink`: anchor nearest-downscaled to fit the target. `plain`:
// no style image. `crop2`: a second roll of the sub-32 props under `crop`.
export type Anchor = "asis" | "crop" | "shrink" | "none";
export type Condition = { id: string; seed: number; anchor: Anchor; only?: (s: Spec) => boolean };
const fits = (s: Spec) => s.w >= ANCHOR.w && s.h >= ANCHOR.h;
const small = (s: Spec) => Math.max(s.w, s.h) <= 32;
export const CONDITIONS: Condition[] = [
  { id: "style", seed: 1123, anchor: "asis", only: fits },
  { id: "crop", seed: 1123, anchor: "crop", only: (s) => !fits(s) },
  { id: "shrink", seed: 1123, anchor: "shrink", only: (s) => !fits(s) },
  { id: "plain", seed: 1123, anchor: "none" },
  { id: "crop2", seed: 2024, anchor: "crop", only: (s) => small(s) && PROPS.includes(s) },
];

// Frame strips: PixelLab animate v3, 4 frames, on the small cat from each condition.
export const STRIPS = [
  { id: "cat-32x24", condition: "crop", action: "the sleeping cat breathes slowly and the tip of its tail twitches now and then" },
  { id: "cat-32x24", condition: "plain", action: "the sleeping cat breathes slowly and the tip of its tail twitches now and then" },
  { id: "cat-24", condition: "crop", action: "the sleeping cat breathes slowly and the tip of its tail twitches now and then" },
];
