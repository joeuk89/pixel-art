import { isFeature, isLocal, MAX_PROP_SIDE, MIN_PROP_SIDE, SIDE_STEP, type Layer, type Placement, type ScenePlan } from "../../schema/index.ts";
import { featureScale, scaleAt } from "./perspective.ts";

export type Canvas = { width: number; height: number };
type Generate = NonNullable<Placement["generate"]>;

export const PRO_FLASH_MAX_SIDE = 256;

// Pro Flash charges by the longer side: 5 generations to 64 px and 9 at 256 (PixelLab price table); 196 px measured 6 and 216 px 9.
const PRO_FLASH_TIERS = [
  { upTo: 64, generations: 5, usd: 0.024 },
  { upTo: 196, generations: 6, usd: 0.029 },
  { upTo: PRO_FLASH_MAX_SIDE, generations: 9, usd: 0.033 },
];

export const OVER_CAP_SERVICES = [
  { service: "pro", generations: 25 },
  { service: "pixflux", generations: 1 },
  { service: "rd-plus", meteredUsd: 0.06 },
] as const;

export type Tier =
  | { service: "pro-flash"; generations: number }
  | { service: null; alternatives: typeof OVER_CAP_SERVICES }
  | { service: "local"; generations: 0 };

function propSide(scale: number, metres: number): number {
  const px = Math.round(scale * metres * 1e6) / 1e6;
  return Math.min(MAX_PROP_SIDE, Math.max(MIN_PROP_SIDE, Math.ceil(px / SIDE_STEP) * SIDE_STEP));
}

export function layerScale(sceneScale: number, layer: Layer): number {
  return layer.kind === "placements" && layer.scale !== undefined ? layer.scale : sceneScale;
}

const hundredths = (n: number) => Math.round(n * 100) / 100;

export function placementScale(plan: Pick<ScenePlan, "scale" | "stage">, layer: Layer, placement: Placement): number {
  if (!plan.stage) return layerScale(plan.scale, layer);
  if (placement.foot) return hundredths(scaleAt(plan.stage, plan.scale, placement.foot.y));
  if (isFeature(placement) && placement.generate?.kind === "prop") {
    return hundredths(featureScale(plan.stage, plan.scale, placement, placement.generate.realSize));
  }
  return layerScale(plan.scale, layer);
}

export function deriveCanvas(scale: number, generate: Generate): Canvas {
  if (generate.kind !== "prop") return { width: generate.size.w, height: generate.size.h };
  return { width: propSide(scale, generate.realSize.w), height: propSide(scale, generate.realSize.h) };
}

export const fitsProFlash = (canvas: Canvas) => canvas.width <= PRO_FLASH_MAX_SIDE && canvas.height <= PRO_FLASH_MAX_SIDE;

function proFlashTier(canvas: Canvas) {
  const side = Math.max(canvas.width, canvas.height);
  return PRO_FLASH_TIERS.find((t) => side <= t.upTo) ?? PRO_FLASH_TIERS[PRO_FLASH_TIERS.length - 1];
}

export const proFlashGenerations = (canvas: Canvas) => proFlashTier(canvas).generations;

export function proFlashPrice(canvas: Canvas): { generations: number; usd: number } {
  const { generations, usd } = proFlashTier(canvas);
  return { generations, usd };
}

export function tier(canvas: Canvas, generate?: Generate): Tier {
  if (generate && isLocal(generate)) return { service: "local", generations: 0 };
  return fitsProFlash(canvas) ? { service: "pro-flash", generations: proFlashGenerations(canvas) } : { service: null, alternatives: OVER_CAP_SERVICES };
}

export function firstAttemptGenerations(canvas: Canvas): number {
  const t = tier(canvas);
  return t.service === null ? OVER_CAP_SERVICES[0].generations : t.generations;
}

export function anchorFits(anchor: Canvas, target: Canvas): boolean {
  return anchor.width <= target.width && anchor.height <= target.height;
}
