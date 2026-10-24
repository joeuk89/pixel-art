import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { editJsonLocked } from "./plan-file.ts";
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

export type Abandoned = {
  placement: string;
  element: string;
  attempts: number;
  outcome: "substituted" | "dropped" | "still";
  substitute?: string;
  droppedPrimitives?: string[];
};

export const abandonedLog = (sceneId: string) => join(stillAttemptsDir(sceneId), "abandoned.json");

export function readAbandoned(sceneId: string): Abandoned[] {
  const log = abandonedLog(sceneId);
  return existsSync(log) ? JSON.parse(readFileSync(log, "utf8")) : [];
}

export function logAbandoned(sceneId: string, entry: Abandoned): string {
  const log = abandonedLog(sceneId);
  mkdirSync(stillAttemptsDir(sceneId), { recursive: true });
  editJsonLocked(log, [], (entries: Abandoned[]) => { entries.push(entry); });
  return log;
}

const placementIds = (entry: Abandoned) => entry.placement.split(", ");

// A reopened Placement gets a new Element, so what was abandoned for it no longer describes the Scene.
export function forgetAbandoned(sceneId: string, placements: string[]): void {
  const log = abandonedLog(sceneId);
  if (!existsSync(log)) return;
  editJsonLocked(log, [], (entries: Abandoned[]) => {
    const kept = entries.flatMap((entry) => {
      const left = placementIds(entry).filter((id) => !placements.includes(id));
      return left.length === 0 ? [] : [{ ...entry, placement: left.join(", ") }];
    });
    entries.splice(0, entries.length, ...kept);
  });
}
