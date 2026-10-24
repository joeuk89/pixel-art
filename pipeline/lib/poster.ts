import type { ScenePlan } from "../../schema/index.ts";
import { createCompositor } from "../../viewer/compositor.ts";
import { loadElementPixels, loadPalette } from "./element-pixels.ts";

export async function posterFrame(root: string, plan: ScenePlan): Promise<Uint8ClampedArray> {
  const [variant] = plan.variants;
  const companion = variant.companionPalette === undefined ? undefined : loadPalette(root, variant.companionPalette);
  const elements = await loadElementPixels(root, plan);
  return createCompositor({ plan, elements, palette: loadPalette(root, plan.palette), variant, companion }).render(0);
}
