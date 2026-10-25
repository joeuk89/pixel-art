import {
  isFeature, roomLayerOf, SCENE_HEIGHT, SCENE_WIDTH, scenePlanSchema, SIDE_STEP,
  type ElementRecord, type Layer, type Placement, type ScenePlan,
} from "../../schema/index.ts";
import { placementScale, propCanvas, type Canvas } from "./canvas.ts";
import { featureBox, type Box, type Point } from "./perspective.ts";

export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 1.5;
export const ZOOM_STEP = 0.05;

export function zoomIssue(zoom: unknown): string | null {
  if (typeof zoom !== "number" || !Number.isFinite(zoom)) return `zoom must be a number, got ${JSON.stringify(zoom)}`;
  if (zoom < ZOOM_MIN - 1e-9 || zoom > ZOOM_MAX + 1e-9) return `zoom ${zoom} is outside ${ZOOM_MIN}x to ${ZOOM_MAX}x of the Stage as saved`;
  const steps = zoom / ZOOM_STEP;
  if (Math.abs(steps - Math.round(steps)) > 1e-6) return `zoom ${zoom} is not on a ${ZOOM_STEP} step`;
  return null;
}

export type StandIn = "exact" | "resampled";

export type ZoomedPlacement = {
  placement: string;
  element: string;
  before: Canvas;
  after: Canvas;
  changed: boolean;
  standIn: StandIn;
  box: Box;
};

export type Zoomed = {
  zoom: number;
  raw: any;
  plan: ScenePlan;
  placements: ZoomedPlacement[];
  reopen: { service: string[]; local: string[]; sizes: Record<string, Canvas> };
  removed: { placements: string[]; lights: string[]; primitives: string[] };
};

const hundredths = (n: number) => Math.round(n * 100) / 100;
const atLeastOne = (n: number) => Math.max(1, Math.round(n));

export function zoomPoint(vp: Point, zoom: number, p: Point): Point {
  return { x: Math.round(vp.x + (p.x - vp.x) * zoom), y: Math.round(vp.y + (p.y - vp.y) * zoom) };
}

function zoomRegion(vp: Point, zoom: number, r: { x: number; y: number; w: number; h: number }) {
  const a = zoomPoint(vp, zoom, r), b = zoomPoint(vp, zoom, { x: r.x + r.w, y: r.y + r.h });
  return { x: a.x, y: a.y, w: Math.max(1, b.x - a.x), h: Math.max(1, b.y - a.y) };
}

// Lights move with the Stage: points about the vanishing point, offsets from an anchor and radii by the ratio.
export function zoomLights<L extends { type: string }>(lights: readonly L[], vp: Point, zoom: number): L[] {
  return lights.map((source) => {
    const light: any = structuredClone(source);
    if (light.type === "beam") {
      light.corners = light.corners.map((c: Point) => zoomPoint(vp, zoom, c));
      return light;
    }
    if (light.at) light.at = zoomPoint(vp, zoom, light.at);
    if (light.offset) light.offset = { x: Math.round(light.offset.x * zoom), y: Math.round(light.offset.y * zoom) };
    light.radius = hundredths(light.radius * zoom);
    if (light.halo) light.halo.radius = hundredths(light.halo.radius * zoom);
    return light;
  });
}

const backdropSize = (o: { w: number; h: number }): Canvas => ({
  width: Math.min(SCENE_WIDTH, Math.ceil(o.w / SIDE_STEP) * SIDE_STEP),
  height: Math.min(SCENE_HEIGHT, Math.ceil(o.h / SIDE_STEP) * SIDE_STEP),
});

const sameCanvas = (a: Canvas, b: Canvas) => a.width === b.width && a.height === b.height;

type Sized = { canvas: Canvas; opening?: string };

function canvasOf(plan: ScenePlan, layer: Layer, p: Placement, record: ElementRecord): Sized {
  if (record.kind === "prop") return { canvas: propCanvas(placementScale(plan, layer, p, record.realSize), record.realSize) };
  if (record.kind === "backdrop") {
    const opening = roomLayerOf(plan)?.openings.find((o) => sameCanvas(backdropSize(o), record));
    if (opening) return { canvas: backdropSize(opening), opening: opening.id };
  }
  return { canvas: { width: record.width, height: record.height } };
}

function pendingOpening(plan: ScenePlan, size: { w: number; h: number }): string | undefined {
  return roomLayerOf(plan)?.openings.find((o) => sameCanvas(backdropSize(o), { width: size.w, height: size.h }))?.id;
}

function boxOf(plan: ScenePlan, p: Placement, size: Canvas): Box {
  if (p.foot) return { x: Math.round(p.foot.x - size.width / 2), y: p.foot.y - size.height, w: size.width, h: size.height };
  if (isFeature(p)) {
    const stage = plan.stage!;
    if (p.surface === "back") return { x: stage.back.x + p.along, y: stage.back.y + p.across, w: size.width, h: size.height };
    return featureBox(stage, p, size);
  }
  return { x: p.x!, y: p.y!, w: size.width, h: size.height };
}

const offCanvas = (b: Box) => b.x + b.w <= 0 || b.y + b.h <= 0 || b.x >= SCENE_WIDTH || b.y >= SCENE_HEIGHT;

function moveRaw(raw: any, zoom: number): void {
  const vp: Point = raw.stage.vanishingPoint;
  const { back } = raw.stage;
  const a = zoomPoint(vp, zoom, back), b = zoomPoint(vp, zoom, { x: back.x + back.w, y: back.y + back.h });
  raw.stage.back = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  raw.stage.f = hundredths(raw.stage.f * zoom);
  raw.scale = hundredths(raw.scale * zoom);
  for (const layer of raw.layers) {
    if (layer.scale !== undefined) layer.scale = hundredths(layer.scale * zoom);
    if (layer.kind === "room") {
      for (const style of Object.values(layer.surfaces) as any[]) {
        if (style?.lines) style.lines.spacing = atLeastOne(style.lines.spacing * zoom);
        if (style?.skirting) style.skirting.height = atLeastOne(style.skirting.height * zoom);
      }
      for (const o of layer.openings) {
        o.along = Math.round(o.along * zoom);
        o.across = Math.round(o.across * zoom);
        o.w = atLeastOne(o.w * zoom);
        o.h = atLeastOne(o.h * zoom);
        if (o.frame) o.frame.width = atLeastOne(o.frame.width * zoom);
      }
    }
    for (const p of layer.placements ?? []) {
      if (p.x !== undefined) Object.assign(p, zoomPoint(vp, zoom, { x: p.x, y: p.y }));
      if (p.foot) p.foot = zoomPoint(vp, zoom, p.foot);
      if (p.along !== undefined) {
        p.along = Math.round(p.along * zoom);
        p.across = Math.round(p.across * zoom);
      }
    }
  }
  const primitives = (list: any[] | undefined) => list?.forEach((prim) => {
    if (prim.region) prim.region = zoomRegion(vp, zoom, prim.region);
    if (prim.offset) prim.offset = { x: Math.round(prim.offset.x * zoom), y: Math.round(prim.offset.y * zoom) };
  });
  primitives(raw.primitives);
  for (const v of raw.variants) {
    v.lights = zoomLights(v.lights, vp, zoom);
    primitives(v.primitives);
  }
}

function drop(raw: any, ids: Set<string>, removed: Zoomed["removed"]): void {
  for (const layer of raw.layers) {
    if (!layer.placements) continue;
    layer.placements = layer.placements.filter((p: any) => !ids.has(p.id));
  }
  const keepPrimitive = (prim: any) => {
    if (!prim.anchor || !ids.has(prim.anchor)) return true;
    removed.primitives.push(`${prim.type} on ${prim.anchor}`);
    return false;
  };
  raw.primitives = raw.primitives.filter(keepPrimitive);
  for (const v of raw.variants) {
    v.lights = v.lights.filter((l: any) => {
      if (!l.anchor || !ids.has(l.anchor)) return true;
      removed.lights.push(`${v.id}/${l.id}`);
      return false;
    });
    v.emissiveOff = v.emissiveOff.filter((pid: string) => !ids.has(pid));
    if (v.primitives) v.primitives = v.primitives.filter(keepPrimitive);
  }
}

function backdropWithoutOpening(plan: ScenePlan, layer: Layer, p: Placement, records: ReadonlyMap<string, ElementRecord>): boolean {
  if (p.generate) return p.generate.kind === "backdrop" && !pendingOpening(plan, p.generate.size);
  const record = records.get(p.element);
  return record?.kind === "backdrop" && !canvasOf(plan, layer, p, record).opening;
}

// A Backdrop not sized to an Opening fills the back of the Scene, and a tileX texture at the top covers the sky,
// so moving either about the vanishing point would leave a band of the canvas uncovered.
function keepCover(before: ScenePlan, raw: any, records: ReadonlyMap<string, ElementRecord>): void {
  const rawPlacements = new Map<string, any>(raw.layers.flatMap((l: any) => l.placements ?? []).map((p: any) => [p.id, p]));
  for (const { layer, p } of layered(before)) {
    if (p.x === undefined || p.y === undefined) continue;
    const moved = rawPlacements.get(p.id);
    if (backdropWithoutOpening(before, layer, p, records)) Object.assign(moved, { x: p.x, y: p.y });
    else if (p.tileX && p.y === 0) moved.y = 0;
  }
}

const layered = (plan: ScenePlan) => plan.layers.flatMap((layer) => ("placements" in layer ? layer.placements : []).map((p) => ({ layer, p })));

// Every coordinate scales by the ratio about the vanishing point, as derive-stage's zoom does: the camera walks forward.
export function zoomScene(raw: unknown, zoom: number, records: ReadonlyMap<string, ElementRecord>): Zoomed {
  const issue = zoomIssue(zoom);
  if (issue) throw new Error(issue);
  const before = scenePlanSchema.parse(raw);
  if (!before.stage) throw new Error(`Scene ${before.id} has no Stage to zoom`);
  const out = structuredClone(raw) as any;
  moveRaw(out, zoom);
  keepCover(before, out, records);
  const moved = scenePlanSchema.parse(out);
  const oldByPlacement = new Map(layered(before).map(({ layer, p }) => [p.id, { layer, p }]));

  const placements: ZoomedPlacement[] = [];
  const sizes: Record<string, Canvas> = {};
  const dropped = new Set<string>();
  const rawPlacements = new Map<string, any>(out.layers.flatMap((l: any) => l.placements ?? []).map((p: any) => [p.id, p]));
  for (const { layer, p } of layered(moved)) {
    if (p.generate) {
      const opening = p.generate.kind === "backdrop" && pendingOpening(before, p.generate.size);
      const movedOpening = opening && roomLayerOf(moved)!.openings.find((o) => o.id === opening);
      if (movedOpening) {
        const size = backdropSize(movedOpening);
        rawPlacements.get(p.id).generate.size = { w: size.width, h: size.height };
      }
      continue;
    }
    const record = records.get(p.element);
    if (!record) throw new Error(`Element ${p.element} of Placement ${p.id} is not in the Element library`);
    const old = oldByPlacement.get(p.id)!;
    const { canvas: canvasBefore, opening } = canvasOf(before, old.layer, old.p, record);
    const movedOpening = opening && roomLayerOf(moved)!.openings.find((o) => o.id === opening);
    const canvasAfter = movedOpening ? backdropSize(movedOpening) : canvasOf(moved, layer, p, record).canvas;
    const changed = !sameCanvas(canvasBefore, canvasAfter);
    const local = record.service === "local" && record.kind === "prop";
    const box = boxOf(moved, p, canvasAfter);
    if (!p.tileX && offCanvas(box)) {
      dropped.add(p.id);
      continue;
    }
    if (changed && opening) sizes[p.id] = canvasAfter;
    placements.push({ placement: p.id, element: p.element, before: canvasBefore, after: canvasAfter, changed, standIn: local ? "exact" : "resampled", box });
  }

  const removed: Zoomed["removed"] = { placements: [...dropped], lights: [], primitives: [] };
  if (dropped.size > 0) drop(out, dropped, removed);
  const changed = placements.filter((z) => z.changed);
  const isLocal = (z: ZoomedPlacement) => z.standIn === "exact";
  return {
    zoom,
    raw: out,
    plan: scenePlanSchema.parse(out),
    placements,
    reopen: { service: changed.filter((z) => !isLocal(z)).map((z) => z.placement), local: changed.filter(isLocal).map((z) => z.placement), sizes },
    removed,
  };
}
