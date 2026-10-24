import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScenePlan } from "../../schema/index.ts";
import { stillAttempts, stillAttemptsDir } from "./attempts.ts";

export const ATTEMPTS_PER_STILL = 4;
export const GENERATION_MULTIPLIER = 3;
export const METERED_CAP_USD = 1;
export const RETRO_DIFFUSION_ATTEMPTS_PER_PROP = 2;
export const RETRO_DIFFUSION_PROPS_PER_SCENE = 4;
export const STRIPS_DIR = "scratch/strips";
// First-Attempt PixelLab generations per call, measured in the PixelLab prototypes.
const FIRST_ATTEMPT = { prop: 5, backdrop: 6, pixellabStrip: 1 };

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

type Planned = { kind: "prop" | "backdrop"; pixellabStrip: boolean };

export function budget(plan: ScenePlan) {
  const placements = plan.layers.flatMap((l) => l.placements ?? []);
  const attempts = stillAttempts(stillAttemptsDir(plan.id));

  const planned = new Map<string, Planned>();
  for (const a of attempts) {
    if (a.element !== undefined && a.kind !== undefined) planned.set(`${a.placement}/${a.element}`, { kind: a.kind, pixellabStrip: a.strip?.service === "pixellab" });
  }
  for (const p of placements) {
    if (!p.generate) continue;
    planned.set(`${p.id}/${p.element}`, { kind: p.generate.kind, pixellabStrip: p.generate.kind === "prop" && p.generate.strip?.service === "pixellab" });
  }
  const estimate = [...planned.values()].reduce((sum, p) => sum + FIRST_ATTEMPT[p.kind] + (p.pixellabStrip ? FIRST_ATTEMPT.pixellabStrip : 0), 0);

  const strips = [...new Set(placements.map((p) => p.element))].map((id) => ({ id, attempts: stripAttempts(id) }));
  const unchargedStrips = strips.flatMap((s) => s.attempts.filter((a) => !a.charged));
  const pending = attempts.filter((a) => !a.charged).reduce((sum, a) => sum + a.generations, 0) +
    unchargedStrips.reduce((sum, a) => sum + a.cost.pixellabGenerations, 0);
  const charged = plan.cost.pixellabGenerations;
  const overage = plan.cost.approvedOverage;
  const pixellabGenerations = { charged, pending, used: charged + pending, estimate, cap: GENERATION_MULTIPLIER * estimate + (overage?.pixellabGenerations ?? 0) };

  const meteredUsed = Object.values(plan.cost.meteredUsd).reduce((sum, usd) => sum + usd, 0) +
    unchargedStrips.reduce((sum, a) => sum + a.cost.meteredUsd, 0);
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
