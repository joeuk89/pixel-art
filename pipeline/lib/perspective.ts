import { SCENE_HEIGHT, SCENE_WIDTH, type Stage, type Surface } from "../../schema/index.ts";

export type { Surface };
export type Point = { x: number; y: number };
// along and across are back-wall pixels from the Surface's corner at the back rectangle: across is depth on the
// floor and ceiling, along is depth on the side walls.
export type Located = { surface: Surface; along: number; across: number };

function box(stage: Stage) {
  const { back, vanishingPoint: vp, f } = stage;
  return { x0: back.x, y0: back.y, x1: back.x + back.w, y1: back.y + back.h, vx: vp.x, vy: vp.y, f };
}

const magnification = (f: number, depth: number) => f / (f - depth);
export const depthOf = (f: number, s: number) => f * (1 - 1 / s);

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

// How far each Surface coordinate runs on the canvas: the depth axis stops where the Surface leaves the canvas.
export function surfaceExtent(stage: Stage, surface: Surface): { along: number; across: number } {
  const { x0, y0, x1, y1, vx, vy, f } = box(stage);
  const w = x1 - x0, h = y1 - y0;
  const depthTo = (s: number) => (s > 1 ? depthOf(f, s) : 0);
  switch (surface) {
    case "back": return { along: w, across: h };
    case "floor": return { along: w, across: y1 > vy ? depthTo((SCENE_HEIGHT - vy) / (y1 - vy)) : 0 };
    case "ceiling": return { along: w, across: vy > y0 ? depthTo(vy / (vy - y0)) : 0 };
    case "left": return { along: vx > x0 ? depthTo(vx / (vx - x0)) : 0, across: h };
    case "right": return { along: x1 > vx ? depthTo((SCENE_WIDTH - vx) / (x1 - vx)) : 0, across: h };
  }
}

export type Size = { width: number; height: number };
export type Box = { x: number; y: number; w: number; h: number };
type At = { surface: Surface; along: number; across: number };
type Named = At & { id: string };

const depthAxis = (surface: Surface) => (surface === "floor" || surface === "ceiling" ? "across" : "along");

function reachable(stage: Stage, f: Named, depth: number): void {
  if (depth >= stage.f) {
    throw new Error(`Feature ${f.id} reaches ${Math.round(depth * 100) / 100} px deep on the ${f.surface}, past the viewing distance of ${stage.f}`);
  }
}

// A Feature is generated square-on at the Scale of its nearest edge, so projecting it onto its Surface only shrinks it.
export function featureScale(stage: Stage, scale: number, f: Named, realSize: { w: number; h: number }): number {
  if (f.surface === "back") return scale;
  const axis = depthAxis(f.surface);
  const depth = f[axis] + (axis === "across" ? realSize.h : realSize.w) * scale;
  reachable(stage, f, depth);
  return (scale * stage.f) / (stage.f - depth);
}

export type Span = { along: number; across: number; w: number; h: number };

// The Feature's extent on its Surface in back-wall pixels, worked back from its square-on size so that its nearest
// edge projects at exactly one square-on pixel per screen pixel.
export function featureSpan(stage: Stage, f: Named, size: Size): Span {
  const { f: distance } = stage;
  if (f.surface === "back") return { along: f.along, across: f.across, w: size.width, h: size.height };
  if (depthAxis(f.surface) === "across") {
    reachable(stage, f, f.across);
    const h = (size.height * (distance - f.across)) / (distance + size.height);
    return { along: f.along, across: f.across, w: (size.width * (distance - f.across - h)) / distance, h };
  }
  reachable(stage, f, f.along);
  const w = (size.width * (distance - f.along)) / (distance + size.width);
  return { along: f.along, across: f.across, w, h: (size.height * (distance - f.along - w)) / distance };
}

export function featureCorners(stage: Stage, f: Named, size: Size): Point[] {
  const s = featureSpan(stage, f, size);
  return [[s.along, s.across], [s.along + s.w, s.across], [s.along + s.w, s.across + s.h], [s.along, s.across + s.h]]
    .map(([a, c]) => project(stage, f.surface, a, c));
}

const EPSILON = 1e-9;

export function featureBox(stage: Stage, f: Named, size: Size): Box {
  const corners = featureCorners(stage, f, size);
  const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
  const x = Math.floor(Math.min(...xs) + EPSILON), y = Math.floor(Math.min(...ys) + EPSILON);
  return { x, y, w: Math.ceil(Math.max(...xs) - EPSILON) - x, h: Math.ceil(Math.max(...ys) - EPSILON) - y };
}
