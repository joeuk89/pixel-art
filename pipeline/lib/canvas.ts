import { MAX_PROP_SIDE, MIN_PROP_SIDE, SIDE_STEP, type Placement } from "../../schema/index.ts";

export type Canvas = { width: number; height: number };
type Generate = NonNullable<Placement["generate"]>;

function propSide(scale: number, metres: number): number {
  const px = Math.round(scale * metres * 1e6) / 1e6;
  return Math.min(MAX_PROP_SIDE, Math.max(MIN_PROP_SIDE, Math.ceil(px / SIDE_STEP) * SIDE_STEP));
}

export function deriveCanvas(scale: number, generate: Generate): Canvas {
  if (generate.kind === "backdrop") return { width: generate.size.w, height: generate.size.h };
  return { width: propSide(scale, generate.realSize.w), height: propSide(scale, generate.realSize.h) };
}

export function anchorFits(anchor: Canvas, target: Canvas): boolean {
  return anchor.width <= target.width && anchor.height <= target.height;
}
