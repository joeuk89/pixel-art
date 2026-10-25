import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import sharp from "sharp";
import { allPlacements, featureFile, isFeature, isProjected, type Feature, type Palette, type ScenePlan, type Stage } from "../../schema/index.ts";
import { readScene } from "./library.ts";
import { featureBox, featureSpan, locate, type Box } from "./perspective.ts";
import { checkerboards, orphans, snapToPalette, type Pixels } from "./pixel-ops.ts";

const ELEMENTS = "library/elements";

export type Projection = { pixels: Pixels; box: Box; opaque: number; offPalette: number; orphans: number; orphanShare: number; checkerboards: number };
export type Projected = Omit<Projection, "pixels"> & { placement: string; element: string; surface: string; file: string };
export type Skipped = { placement: string; reason: string };

// Every pixel of the box reads the square-on pixel under its centre, kept in screen orientation on every Surface.
export function projectFeature(stage: Stage, feature: Feature, source: Pixels): { pixels: Pixels; box: Box } {
  const size = { width: source.width, height: source.height };
  const box = featureBox(stage, feature, size);
  const span = featureSpan(stage, feature, size);
  const data = new Uint8Array(box.w * box.h * 4);
  const mirrored = (feature.surface === "left") !== (feature.flipX === true);
  for (let j = 0; j < box.h; j++) {
    for (let i = 0; i < box.w; i++) {
      const at = locate(stage, box.x + i, box.y + j);
      if (!at || at.surface !== feature.surface) continue;
      const u = (at.along - span.along) / span.w, v = (at.across - span.across) / span.h;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      let sx = Math.min(source.width - 1, Math.floor(u * source.width));
      let sy = Math.min(source.height - 1, Math.floor(v * source.height));
      if (mirrored) sx = source.width - 1 - sx;
      if (feature.surface === "ceiling") sy = source.height - 1 - sy;
      const s = (sy * source.width + sx) * 4;
      if (source.data[s + 3] < 128) continue;
      const d = (j * box.w + i) * 4;
      data.set(source.data.subarray(s, s + 3), d);
      data[d + 3] = 255;
    }
  }
  return { pixels: { width: box.w, height: box.h, data }, box };
}

export function renderProjection(stage: Stage, feature: Feature, source: Pixels, palette: Palette): Projection {
  const { pixels, box } = projectFeature(stage, feature, source);
  const snapped = snapToPalette(pixels, palette.colours);
  const orphan = orphans(snapped.frame);
  return {
    pixels: snapped.frame, box, opaque: snapped.opaque, offPalette: snapped.offPalette,
    orphans: orphan.count, orphanShare: orphan.share, checkerboards: checkerboards(snapped.frame),
  };
}

export async function decodePng(path: string): Promise<Pixels> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

export const projectedFeatures = (plan: ScenePlan): Feature[] => allPlacements(plan).filter(isProjected);

export async function freshProjection(root: string, plan: ScenePlan, feature: Feature, palette: Palette): Promise<Projection> {
  if (!plan.stage) throw new Error(`Scene ${plan.id} has no Stage to project Feature ${feature.id} through`);
  const source = await decodePng(join(root, ELEMENTS, `${feature.element}.png`));
  return renderProjection(plan.stage, feature, source, palette);
}

export async function writeProjections(root: string, planPath: string, plan: ScenePlan, palette: Palette, ids: string[] = []): Promise<{ features: Projected[]; skipped: Skipped[] }> {
  const placements = allPlacements(plan);
  for (const id of ids) {
    const found = placements.find((p) => p.id === id);
    if (!found) throw new Error(`no Placement ${id} in Scene ${plan.id}`);
    if (!isFeature(found)) throw new Error(`Placement ${id} is not a Feature on a Surface`);
  }
  const chosen = placements.filter(isFeature).filter((p) => ids.length === 0 || ids.includes(p.id));
  const features: Projected[] = [];
  const skipped: Skipped[] = [];
  for (const feature of chosen) {
    if (feature.surface === "back") {
      if (ids.length > 0) skipped.push({ placement: feature.id, reason: "a back-wall Feature draws 1:1 from its library PNG and needs no projected file" });
      continue;
    }
    if (feature.generate || !existsSync(join(root, ELEMENTS, `${feature.element}.png`))) {
      skipped.push({ placement: feature.id, reason: `Element ${feature.element} is not generated yet` });
      continue;
    }
    const { pixels, ...report } = await freshProjection(root, plan, feature, palette);
    const out = join(dirname(planPath), featureFile(feature.id));
    mkdirSync(dirname(out), { recursive: true });
    await sharp(pixels.data, { raw: { width: pixels.width, height: pixels.height, channels: 4 } }).png().toFile(out);
    features.push({ placement: feature.id, element: feature.element, surface: feature.surface, file: relative(root, out), ...report });
  }
  return { features, skipped };
}

export async function projectAccepted(root: string, file: string, placementId: string, palette: Palette): Promise<{ projected?: Projected }> {
  const planPath = resolve(root, file);
  const plan = readScene(planPath);
  const placement = allPlacements(plan).find((p) => p.id === placementId);
  if (!placement || !isProjected(placement)) return {};
  const { features } = await writeProjections(root, planPath, plan, palette, [placementId]);
  return { projected: features[0] };
}
