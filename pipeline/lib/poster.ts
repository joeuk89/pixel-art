import type { ScenePlan } from "../../schema/index.ts";
import { createCompositor } from "../../viewer/compositor.ts";
import { loadElementPixels, loadFeaturePixels, loadPalette, loadRoomPixels } from "./element-pixels.ts";

export async function posterFrame(root: string, sceneDir: string, plan: ScenePlan): Promise<Uint8ClampedArray> {
  const [variant] = plan.variants;
  const companion = variant.companionPalette === undefined ? undefined : loadPalette(root, variant.companionPalette);
  const elements = await loadElementPixels(root, plan);
  const room = await loadRoomPixels(sceneDir, plan);
  const features = await loadFeaturePixels(sceneDir, plan);
  return createCompositor({ plan, elements, palette: loadPalette(root, plan.palette), variant, companion, room, features }).render(0);
}
