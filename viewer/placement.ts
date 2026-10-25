import { isFeature, type Placement, type Stage } from "../schema/index.ts";
import { featureBox } from "../pipeline/lib/perspective.ts";

export type Positioned = Placement & { x: number; y: number };
export type Size = { width: number; height: number };

// size is the Element's own size: the square-on PNG for a Feature, whose projected box is worked out from it.
export function positioned(p: Placement, size: Size, stage?: Stage): Positioned {
  if (p.foot) return { ...p, x: Math.round(p.foot.x - size.width / 2), y: p.foot.y - size.height };
  if (!isFeature(p)) return p as Positioned;
  if (!stage) throw new Error(`Feature ${p.id}: a surface position needs a Stage`);
  if (p.surface === "back") return { ...p, x: stage.back.x + p.along, y: stage.back.y + p.across };
  const box = featureBox(stage, p, size);
  return { ...p, x: box.x, y: box.y };
}
