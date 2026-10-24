import { MAX_PROP_SIDE, MIN_PROP_SIDE, SIDE_STEP, type Layer, type Placement } from "../../schema/index.ts";

export type Canvas = { width: number; height: number };
type Generate = NonNullable<Placement["generate"]>;

export const PRO_FLASH_MAX_SIDE = 256;

// Pro Flash charges by the longer side: 5 generations to 64 px and 9 at 256 (PixelLab price table); 196 px measured 6 and 216 px 9.
const PRO_FLASH_TIERS = [{ upTo: 64, generations: 5 }, { upTo: 196, generations: 6 }, { upTo: PRO_FLASH_MAX_SIDE, generations: 9 }];

export const OVER_CAP_SERVICES = [
  { service: "pro", generations: 25 },
  { service: "pixflux", generations: 1 },
  { service: "rd-plus", meteredUsd: 0.06 },
] as const;

export type Tier = { service: "pro-flash"; generations: number } | { service: null; alternatives: typeof OVER_CAP_SERVICES };

function propSide(scale: number, metres: number): number {
  const px = Math.round(scale * metres * 1e6) / 1e6;
  return Math.min(MAX_PROP_SIDE, Math.max(MIN_PROP_SIDE, Math.ceil(px / SIDE_STEP) * SIDE_STEP));
}

export function layerScale(sceneScale: number, layer: Layer): number {
  return layer.kind === "placements" && layer.scale !== undefined ? layer.scale : sceneScale;
}

export function deriveCanvas(scale: number, generate: Generate): Canvas {
  if (generate.kind === "backdrop") return { width: generate.size.w, height: generate.size.h };
  return { width: propSide(scale, generate.realSize.w), height: propSide(scale, generate.realSize.h) };
}

export const fitsProFlash = (canvas: Canvas) => canvas.width <= PRO_FLASH_MAX_SIDE && canvas.height <= PRO_FLASH_MAX_SIDE;

export function proFlashGenerations(canvas: Canvas): number {
  const side = Math.max(canvas.width, canvas.height);
  return PRO_FLASH_TIERS.find((t) => side <= t.upTo)?.generations ?? PRO_FLASH_TIERS[PRO_FLASH_TIERS.length - 1].generations;
}

export function tier(canvas: Canvas): Tier {
  return fitsProFlash(canvas) ? { service: "pro-flash", generations: proFlashGenerations(canvas) } : { service: null, alternatives: OVER_CAP_SERVICES };
}

export function anchorFits(anchor: Canvas, target: Canvas): boolean {
  return anchor.width <= target.width && anchor.height <= target.height;
}
