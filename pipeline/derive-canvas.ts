import { parseArgs } from "node:util";
import { isLocal, placementsOf } from "../schema/index.ts";
import { anchorFits, deriveCanvas, firstAttemptGenerations, placementScale, tier, type Canvas } from "./lib/canvas.ts";
import { main } from "./lib/cli.ts";
import { finishOffer } from "./lib/finish-offer.ts";
import { readElements, readScene } from "./lib/library.ts";

main(() => {
  const { values, positionals } = parseArgs({ options: { eligible: { type: "string", multiple: true, default: [] } }, allowPositionals: true });
  const [file, ...rest] = positionals;
  if (!file || rest.length > 0) throw new Error("usage: derive-canvas <scene.json> [--eligible <placementId>]...");
  const plan = readScene(file);

  let anchor: (Canvas & { id: string }) | null = null;
  if (plan.styleAnchor !== null) {
    const record = readElements().find((e) => e.id === plan.styleAnchor);
    if (!record) throw new Error(`Style anchor ${plan.styleAnchor} is not in the Element library`);
    anchor = { id: record.id, width: record.width, height: record.height };
  }

  const placements = plan.layers.flatMap((layer) =>
    placementsOf(layer).flatMap((p) => {
      if (!p.generate) return [];
      const scale = placementScale(plan, layer, p);
      const canvas = deriveCanvas(scale, p.generate);
      return [{
        layer: layer.name,
        placement: p.id,
        element: p.element,
        kind: p.generate.kind,
        finish: isLocal(p.generate) ? "local" : "service",
        ...(p.generate.kind === "prop" ? { scale, realSize: p.generate.realSize } : {}),
        canvas,
        tier: tier(canvas, p.generate),
        anchorFits: anchor === null ? null : anchorFits(anchor, canvas),
      }];
    }),
  );
  const generations = placements.reduce((sum, p) => sum + (p.tier.service === "local" ? 0 : firstAttemptGenerations(p.canvas)), 0);

  return { scene: plan.id, scale: plan.scale, styleAnchor: anchor, generations, placements, finishOffer: finishOffer(plan, values.eligible) };
});
