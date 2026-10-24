import type { ScenePlan } from "../../schema/index.ts";
import { createCompositor } from "../../viewer/compositor.ts";
import { loadElementPixels, loadPalette } from "./element-pixels.ts";

export async function posterFrame(root: string, plan: ScenePlan): Promise<Uint8ClampedArray> {
  return createCompositor({ plan, elements: await loadElementPixels(root, plan), palette: loadPalette(root, plan.palette) }).render(0);
}
