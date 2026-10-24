import type { Placement } from "../schema/index.ts";

export type Positioned = Placement & { x: number; y: number };
export type Size = { width: number; height: number };

export function positioned(p: Placement, size: Size): Positioned {
  if (!p.foot) return p as Positioned;
  return { ...p, x: Math.round(p.foot.x - size.width / 2), y: p.foot.y - size.height };
}
