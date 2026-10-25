import { join } from "node:path";
import { isProjected, type ElementRecord, type Palette } from "../../schema/index.ts";
import { placementScale } from "./canvas.ts";
import { decodePng } from "./element-pixels.ts";
import { renderProjection } from "./features.ts";
import { drawLocal } from "./kits/index.ts";
import type { Pixels } from "./pixel-ops.ts";
import type { Canvas } from "./canvas.ts";
import type { StandIn, Zoomed } from "./zoom.ts";

const ELEMENTS = "library/elements";

export type StandInSuffix = ".png" | ".strip.png" | ".emissive.png";

// Nearest-neighbour, frame by frame, reading the source pixel under each target pixel's centre.
export function resample(source: Pixels, frame: Canvas, frames = 1): Pixels {
  const fw = source.width / frames;
  const width = frame.width * frames, height = frame.height;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(source.height - 1, Math.floor(((y + 0.5) * source.height) / height));
    for (let x = 0; x < width; x++) {
      const f = Math.floor(x / frame.width), fx = x - f * frame.width;
      const sx = f * fw + Math.min(fw - 1, Math.floor(((fx + 0.5) * fw) / frame.width));
      const s = (sy * source.width + sx) * 4;
      data.set(source.data.subarray(s, s + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

export type StandInImage = { pixels: Pixels; kind: StandIn };

export function zoomedEntry(zoomed: Zoomed, placementId: string) {
  const entry = zoomed.placements.find((z) => z.placement === placementId);
  if (!entry) return undefined;
  const layer = zoomed.plan.layers.find((l) => "placements" in l && l.placements.some((p) => p.id === placementId))!;
  const placement = ("placements" in layer ? layer.placements : []).find((p) => p.id === placementId)!;
  return { entry, layer, placement };
}

export async function standInImage(root: string, zoomed: Zoomed, placementId: string, suffix: StandInSuffix, record: ElementRecord, palette: Palette): Promise<StandInImage | undefined> {
  const found = zoomedEntry(zoomed, placementId);
  if (!found) return undefined;
  const { entry, layer, placement } = found;
  if (entry.standIn === "exact" && record.kind === "prop" && record.generator !== undefined && suffix === ".png") {
    const scale = placementScale(zoomed.plan, layer, placement, record.realSize);
    const target = { width: scale * record.realSize.w, height: scale * record.realSize.h };
    return { pixels: drawLocal(record.generator, record.params, { canvas: entry.after, target, palette }).pixels, kind: "exact" };
  }
  if (suffix === ".strip.png" && !(record.kind === "prop" && record.animation)) return undefined;
  if (suffix === ".emissive.png" && !record.emissiveMask) return undefined;
  const source = await decodePng(join(root, ELEMENTS, `${record.id}${suffix}`));
  const frames = suffix === ".strip.png" && record.kind === "prop" && record.animation ? record.animation.frames : 1;
  return { pixels: resample(source, entry.after, frames), kind: "resampled" };
}

export async function standInFeature(root: string, zoomed: Zoomed, placementId: string, record: ElementRecord, palette: Palette): Promise<StandInImage | undefined> {
  const found = zoomedEntry(zoomed, placementId);
  if (!found || !isProjected(found.placement) || !zoomed.plan.stage) return undefined;
  const still = await standInImage(root, zoomed, placementId, ".png", record, palette);
  if (!still) return undefined;
  return { pixels: renderProjection(zoomed.plan.stage, found.placement, still.pixels, palette).pixels, kind: still.kind };
}
