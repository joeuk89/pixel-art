import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GateReport } from "./quality-gate.ts";

export const stillAttemptsDir = (sceneId: string) => `scratch/attempts/${sceneId}`;

export type StillAttempt = {
  scene: string;
  placement: string;
  element?: string;
  kind?: "prop" | "backdrop";
  strip?: { service: string; frames: number };
  attempt: number;
  canvas: { width: number; height: number };
  prompt: string;
  seed: number;
  generations: number;
  params: Record<string, unknown>;
  styleAnchor: string | null;
  gate: GateReport;
  charged?: boolean;
};

type Found = { file: string; value: StillAttempt };

function sidecars(dir: string, prefixFor: (name: string) => boolean): Found[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /-a\d+\.json$/.test(n) && prefixFor(n))
    .sort()
    .map((n) => ({ file: join(dir, n), value: JSON.parse(readFileSync(join(dir, n), "utf8")) as StillAttempt }));
}

export function stillAttempts(dir: string, placementId?: string): StillAttempt[] {
  return sidecars(dir, (n) => placementId === undefined || n.startsWith(`${placementId}-a`))
    .map((f) => f.value)
    .filter((a) => placementId === undefined || a.placement === placementId);
}

// Every Attempt costs, accepted or not; marking them charged keeps a later accept or abandon from charging them again.
export function chargeStillAttempts(dir: string, placementId: string): { generations: number; attempts: number; commit: () => void } {
  const open = sidecars(dir, (n) => n.startsWith(`${placementId}-a`)).filter((f) => f.value.placement === placementId && !f.value.charged);
  return {
    generations: open.reduce((sum, f) => sum + f.value.generations, 0),
    attempts: open.length,
    commit: () => {
      for (const f of open) writeFileSync(f.file, JSON.stringify({ ...f.value, charged: true }, null, 2) + "\n");
    },
  };
}
