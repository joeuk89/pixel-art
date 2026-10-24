import { SCENE_HEIGHT, SCENE_WIDTH, type Stage } from "../../schema/index.ts";

export type Surface = "back" | "floor" | "ceiling" | "left" | "right";
export type Point = { x: number; y: number };
// along and across are back-wall pixels from the Surface's corner at the back rectangle: across is depth on the
// floor and ceiling, along is depth on the side walls.
export type Located = { surface: Surface; along: number; across: number };

function box(stage: Stage) {
  const { back, vanishingPoint: vp, f } = stage;
  return { x0: back.x, y0: back.y, x1: back.x + back.w, y1: back.y + back.h, vx: vp.x, vy: vp.y, f };
}

const magnification = (f: number, depth: number) => f / (f - depth);
const depthOf = (f: number, s: number) => f * (1 - 1 / s);

export function project(stage: Stage, surface: Surface, along: number, across: number): Point {
  const { x0, y0, x1, y1, vx, vy, f } = box(stage);
  if (surface === "back") return { x: x0 + along, y: y0 + across };
  if (surface === "floor" || surface === "ceiling") {
    const s = magnification(f, across);
    const x = vx + (x0 + along - vx) * s;
    return { x, y: surface === "floor" ? vy + (y1 - vy) * s : vy - (vy - y0) * s };
  }
  const s = magnification(f, along);
  const y = vy + (y0 + across - vy) * s;
  return { x: surface === "left" ? vx - (vx - x0) * s : vx + (x1 - vx) * s, y };
}

export function locate(stage: Stage, px: number, py: number): Located | null {
  const { x0, y0, x1, y1, vx, vy, f } = box(stage);
  const x = px + 0.5, y = py + 0.5;
  if (x >= x0 && x < x1 && y >= y0 && y < y1) return { surface: "back", along: x - x0, across: y - y0 };
  if (y >= y1) {
    const s = (y - vy) / (y1 - vy), u = vx + (x - vx) / s;
    if (u >= x0 && u < x1) return { surface: "floor", along: u - x0, across: depthOf(f, s) };
  }
  if (y < y0) {
    const s = (vy - y) / (vy - y0), u = vx + (x - vx) / s;
    if (u >= x0 && u < x1) return { surface: "ceiling", along: u - x0, across: depthOf(f, s) };
  }
  if (x < x0) {
    const s = (vx - x) / (vx - x0), v = vy + (y - vy) / s;
    if (v >= y0 && v < y1) return { surface: "left", along: depthOf(f, s), across: v - y0 };
  }
  if (x >= x1) {
    const s = (x - vx) / (x1 - vx), v = vy + (y - vy) / s;
    if (v >= y0 && v < y1) return { surface: "right", along: depthOf(f, s), across: v - y0 };
  }
  return null;
}

export function scaleAt(stage: Stage, scale: number, footY: number): number {
  const { y1, vy } = box(stage);
  return (scale * (footY - vy)) / (y1 - vy);
}

export function floorPolygon(stage: Stage): Point[] {
  const { x0, x1, y1, vx, vy } = box(stage);
  if (y1 <= vy || y1 >= SCENE_HEIGHT) return [];
  const atBottom = (x: number) => vx + ((x - vx) * (SCENE_HEIGHT - vy)) / (y1 - vy);
  const atEdge = (edge: number, x: number) => vy + ((y1 - vy) * (edge - vx)) / (x - vx);
  const points: Point[] = [{ x: Math.max(x0, 0), y: y1 }, { x: Math.min(x1, SCENE_WIDTH), y: y1 }];
  if (x1 >= SCENE_WIDTH) points.push({ x: SCENE_WIDTH, y: SCENE_HEIGHT });
  else if (atBottom(x1) > SCENE_WIDTH) points.push({ x: SCENE_WIDTH, y: atEdge(SCENE_WIDTH, x1) }, { x: SCENE_WIDTH, y: SCENE_HEIGHT });
  else points.push({ x: atBottom(x1), y: SCENE_HEIGHT });
  if (x0 <= 0) points.push({ x: 0, y: SCENE_HEIGHT });
  else if (atBottom(x0) < 0) points.push({ x: 0, y: SCENE_HEIGHT }, { x: 0, y: atEdge(0, x0) });
  else points.push({ x: atBottom(x0), y: SCENE_HEIGHT });
  return points.filter((p, i) => {
    const prev = points[(i + points.length - 1) % points.length];
    return p.x !== prev.x || p.y !== prev.y;
  });
}

export function onFloor(stage: Stage, foot: Point): boolean {
  const { x0, x1, y1, vx, vy } = box(stage);
  if (y1 <= vy || foot.y < y1 || foot.y > SCENE_HEIGHT || foot.x < 0 || foot.x > SCENE_WIDTH) return false;
  const u = vx + ((foot.x - vx) * (y1 - vy)) / (foot.y - vy);
  return u >= x0 && u <= x1;
}
