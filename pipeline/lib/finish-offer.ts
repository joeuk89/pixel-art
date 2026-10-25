import { placementsOf, type ScenePlan } from "../../schema/index.ts";
import { USD_PER_GBP } from "./budget.ts";
import { deriveCanvas, placementScale, proFlashPrice, type Canvas } from "./canvas.ts";

export const TRADE_OFF = "local: exact geometry, flat and plainer; service: richer detail and shading";

type Offered = { placement: string; finish: "local" | "service"; canvas: Canvas; service: { generations: number; usd: number }; local: { gbp: 0 } };

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function finishOffer(plan: ScenePlan, named: string[]) {
  const placements = plan.layers.flatMap((layer) => placementsOf(layer).map((p) => ({ layer, p })));
  for (const id of named) {
    const found = placements.find(({ p }) => p.id === id);
    if (!found) throw new Error(`--eligible: no Placement ${id} in this plan`);
    if (!found.p.generate) throw new Error(`--eligible: ${id} has no generate block, so it has no Finish to choose`);
    if (found.p.generate.kind !== "prop") throw new Error(`--eligible: ${id} is a ${found.p.generate.kind}: only a prop is offered a local Finish`);
  }
  const eligible: Offered[] = placements.flatMap(({ layer, p }) => {
    const g = p.generate;
    if (g?.kind !== "prop" || (g.finish !== "local" && !named.includes(p.id))) return [];
    const canvas = deriveCanvas(placementScale(plan, layer, p), g);
    return [{ placement: p.id, finish: g.finish, canvas, service: proFlashPrice(canvas), local: { gbp: 0 } }];
  });
  const usd = round4(eligible.reduce((sum, e) => sum + e.service.usd, 0));
  return {
    eligible,
    saving: { generations: eligible.reduce((sum, e) => sum + e.service.generations, 0), usd, gbp: round4(usd / USD_PER_GBP) },
    tradeOff: TRADE_OFF,
  };
}
