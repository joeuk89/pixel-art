import { BACKDROP_HEIGHT, BACKDROP_WIDTH, type Placement } from "../../schema/index.ts";

const MIN_PROP_SIDE = 16;
const MAX_PROP_SIDE = 128;
const STEP = 4;

export type Canvas = { width: number; height: number };
type Generate = NonNullable<Placement["generate"]>;

function propSide(scale: number, metres: number): number {
  const px = Math.round(scale * metres * 1e6) / 1e6;
  return Math.min(MAX_PROP_SIDE, Math.max(MIN_PROP_SIDE, Math.ceil(px / STEP) * STEP));
}

export function deriveCanvas(scale: number, generate: Generate): Canvas {
  if (generate.kind === "backdrop") return { width: BACKDROP_WIDTH, height: BACKDROP_HEIGHT };
  return { width: propSide(scale, generate.realSize.w), height: propSide(scale, generate.realSize.h) };
}

export function anchorFits(anchor: Canvas, target: Canvas): boolean {
  return anchor.width <= target.width && anchor.height <= target.height;
}
