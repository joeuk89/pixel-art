export type ElementSpec = {
  id: string;
  // Subject only. The style handles the pixel-art rendering; the background phrase is per the Retro Diffusion craft guide.
  prompt: string;
  // Width and height at the 64px tier; other tiers scale by 0.5 and 2.
  w: number;
  h: number;
  transparent: boolean;
};

export const ELEMENTS: ElementSpec[] = [
  { id: "lamp", prompt: "a small desk lamp with a warm yellow conical shade on a brass stem, switched on, glowing warm light, on a plain white background", w: 64, h: 64, transparent: true },
  { id: "window", prompt: "a large wooden-framed window at night, rain streaks running down the glass, dark blue night outside with a few distant lit windows, viewed straight on, on a plain white background", w: 64, h: 64, transparent: true },
  { id: "skyline", prompt: "a distant city skyline at night under a deep purple sky, silhouetted rooftops and towers with a scattering of small lit windows, wide view", w: 128, h: 64, transparent: false },
  { id: "cat", prompt: "a sleeping ginger cat curled up in a ball, eyes closed, tail tucked around its body, seen from the side, on a plain white background", w: 64, h: 64, transparent: true },
  { id: "mug", prompt: "a ceramic mug of hot coffee with curling white steam rising from it, seen from the side, on a plain white background", w: 64, h: 64, transparent: true },
];

export const TIERS = [32, 64, 128] as const;
export type Tier = (typeof TIERS)[number];
export function sizeAt(e: ElementSpec, tier: Tier) {
  const f = tier / 64;
  return { width: Math.round(e.w * f), height: Math.round(e.h * f) };
}
