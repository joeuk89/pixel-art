import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { allPlacements, isLocal, placementsOf, type ScenePlan } from "../../schema/index.ts";
import { stillAttempts, stillAttemptsDir } from "./attempts.ts";
import { deriveCanvas, firstAttemptGenerations, placementScale, type Canvas } from "./canvas.ts";
import { readElements } from "./library.ts";

export const ATTEMPTS_PER_STILL = 4;
export const GENERATION_MULTIPLIER = 3;
export const METERED_CAP_USD = 1;
// The spec sets ceilings in pounds but services bill in dollars; this rate is an assumption, printed with each result.
export const USD_PER_GBP = 1.3;
export const RETRO_DIFFUSION_ATTEMPTS_PER_PROP = 2;
export const RETRO_DIFFUSION_PROPS_PER_SCENE = 4;
export const STRIPS_DIR = "scratch/strips";
const PIXELLAB_STRIP_GENERATIONS = 1;

export type StripAttempt = {
  element: string;
  service: string;
  cost: { pixellabGenerations: number; meteredUsd: number };
  charged?: boolean;
};

export function stripAttempts(id: string): StripAttempt[] {
  if (!existsSync(STRIPS_DIR)) return [];
  return readdirSync(STRIPS_DIR)
    .filter((n) => n.startsWith(`${id}-a`) && /^\d+\.json$/.test(n.slice(id.length + 2)))
    .map((n) => JSON.parse(readFileSync(join(STRIPS_DIR, n), "utf8")) as StripAttempt);
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

type Planned = { canvas: Canvas; pixellabStrip: boolean; local: boolean };

export function budget(plan: ScenePlan) {
  const placements = allPlacements(plan);
  const attempts = stillAttempts(stillAttemptsDir(plan.id));

  const planned = new Map<string, Planned>();
  for (const a of attempts) {
    if (a.element !== undefined) planned.set(`${a.placement}/${a.element}`, { canvas: a.canvas, pixellabStrip: a.strip?.service === "pixellab", local: a.service === "local" });
  }
  for (const layer of plan.layers) {
    for (const p of placementsOf(layer)) {
      if (!p.generate) continue;
      const canvas = deriveCanvas(placementScale(plan, layer, p), p.generate);
      planned.set(`${p.id}/${p.element}`, { canvas, pixellabStrip: p.generate.kind === "prop" && p.generate.strip?.service === "pixellab", local: isLocal(p.generate) });
    }
  }
  const estimate = [...planned.values()].reduce(
    (sum, p) => sum + (p.local ? 0 : firstAttemptGenerations(p.canvas)) + (p.pixellabStrip ? PIXELLAB_STRIP_GENERATIONS : 0), 0);

  // Only Elements this Scene generated get strips here; strip Attempts on reused Elements belong to the Scene that made them.
  const strips = readElements().filter((e) => e.firstScene === plan.id).map((e) => ({ id: e.id, attempts: stripAttempts(e.id) }));
  const unchargedStrips = strips.flatMap((s) => s.attempts.filter((a) => !a.charged));
  const pending = attempts.filter((a) => !a.charged).reduce((sum, a) => sum + a.generations, 0) +
    unchargedStrips.reduce((sum, a) => sum + a.cost.pixellabGenerations, 0);
  const charged = plan.cost.pixellabGenerations;
  const overage = plan.cost.approvedOverage;
  const pixellabGenerations = { charged, pending, used: charged + pending, estimate, cap: GENERATION_MULTIPLIER * estimate + (overage?.pixellabGenerations ?? 0) };

  const meteredUsed = Object.values(plan.cost.meteredUsd).reduce((sum, usd) => sum + usd, 0) +
    unchargedStrips.reduce((sum, a) => sum + a.cost.meteredUsd, 0) +
    attempts.filter((a) => !a.charged).reduce((sum, a) => sum + (a.meteredUsd ?? 0), 0);
  const meteredUsd = { used: round(meteredUsed), cap: round(METERED_CAP_USD + (overage?.meteredUsd ?? 0)) };

  const stills = placements.filter((p) => p.generate).map((p) => ({
    placement: p.id,
    element: p.element,
    attempts: attempts.filter((a) => a.placement === p.id && a.element === p.element).length,
    cap: ATTEMPTS_PER_STILL,
  }));

  const rdProps = strips
    .map((s) => ({ element: s.id, attempts: s.attempts.filter((a) => a.service === "retro-diffusion").length }))
    .filter((s) => s.attempts > 0);
  const retroDiffusion = { props: rdProps, propCap: RETRO_DIFFUSION_PROPS_PER_SCENE, attemptCap: RETRO_DIFFUSION_ATTEMPTS_PER_PROP };

  const capsHit = [
    ...stills.filter((s) => s.attempts >= s.cap).map((s) => `${s.placement} (${s.element}) has had ${s.attempts} of ${s.cap} Attempts`),
    ...(pixellabGenerations.used >= pixellabGenerations.cap ? [`PixelLab generations: ${pixellabGenerations.used} used of ${pixellabGenerations.cap}`] : []),
    ...(meteredUsd.used >= meteredUsd.cap ? [`metered: $${meteredUsd.used} used of $${meteredUsd.cap}`] : []),
    ...(rdProps.length >= retroDiffusion.propCap ? [`Retro Diffusion: ${rdProps.length} of ${retroDiffusion.propCap} props`] : []),
    ...rdProps.filter((p) => p.attempts >= retroDiffusion.attemptCap).map((p) => `Retro Diffusion: ${p.element} has had ${p.attempts} of ${retroDiffusion.attemptCap} charged Attempts`),
  ];
  return { scene: plan.id, stills, pixellabGenerations, meteredUsd, retroDiffusion, capsHit };
}

export type Budget = ReturnType<typeof budget>;
