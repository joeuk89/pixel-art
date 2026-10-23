// Ten Elements for one Scene plan: "a cosy study at night while it rains". Briefs follow the #15 rules:
// subject only, no engine-animated motion (rain, steam, glow), transparent openings where the backdrop shows through.
export type ElementSpec = { id: string; brief: string; w: number; h: number; transparent: boolean };

export const ELEMENTS: ElementSpec[] = [
  // First Element is the style anchor in the style-locked conditions.
  { id: "window", brief: "a large wooden-framed window, closed, four panes, the glass fully transparent so the scene behind shows through, seen straight on", w: 64, h: 64, transparent: true },
  { id: "lamp", brief: "a small desk lamp with a warm yellow conical shade on a brass stem, switched on", w: 64, h: 64, transparent: true },
  { id: "cat", brief: "a sleeping ginger cat curled up in a ball, eyes closed, tail tucked around its body, seen from the side", w: 64, h: 64, transparent: true },
  { id: "mug", brief: "a ceramic mug of hot coffee with a patterned band, seen from the side", w: 64, h: 64, transparent: true },
  { id: "bookshelf", brief: "a tall wooden bookshelf filled with books of different heights and colours, seen straight on", w: 64, h: 64, transparent: true },
  { id: "armchair", brief: "a worn green armchair with a knitted blanket draped over one arm, seen from the side", w: 64, h: 64, transparent: true },
  { id: "plant", brief: "a leafy potted plant in a terracotta pot, seen from the side", w: 64, h: 64, transparent: true },
  { id: "radio", brief: "a vintage wooden tabletop radio with a round dial and fabric speaker grille, seen from the front", w: 64, h: 64, transparent: true },
  { id: "clock", brief: "a round wall clock with a wooden frame and cream face, seen straight on", w: 64, h: 64, transparent: true },
  { id: "skyline", brief: "a distant city skyline at night under a deep purple sky, silhouetted rooftops and towers with a scattering of small lit windows, wide view", w: 128, h: 64, transparent: false },
];

export const ANCHOR = ELEMENTS[0];

// Conditions. `style` means: pass the anchor from the named condition as style_image.
export type Condition = { id: string; seed: number; style?: string; options?: Record<string, boolean>; only?: string[] };
export const CONDITIONS: Condition[] = [
  { id: "base-s1", seed: 1123 },
  { id: "base-s2", seed: 2024 },
  { id: "style-s1", seed: 1123, style: "base-s1" },
  { id: "style-s2", seed: 2024, style: "base-s1" },
  // Same request as base-s1 twice, to measure whether the seed is deterministic.
  { id: "repeat-s1", seed: 1123, only: ["window", "cat", "skyline"] },
];
