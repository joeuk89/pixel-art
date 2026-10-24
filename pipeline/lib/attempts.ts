import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { editJsonLocked } from "./plan-file.ts";
import type { GateReport } from "./quality-gate.ts";

export const stillAttemptsDir = (sceneId: string) => `scratch/attempts/${sceneId}`;

export type StillAttempt = {
  scene: string;
  placement: string;
  element?: string;
  kind?: "prop" | "backdrop" | "texture";
  strip?: { service: string; frames: number };
  attempt: number;
  canvas: { width: number; height: number };
  prompt: string;
  seed: number | null;
  service?: "pro-flash" | "pro" | "pixflux" | "rd-plus" | "local";
  generator?: string;
  generations: number;
  meteredUsd?: number;
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

const METERED_VENDOR = "retro-diffusion";

// Every Attempt costs, accepted or not; marking them charged keeps a later accept or abandon from charging them again.
export function chargeStillAttempts(dir: string, placementId: string): { generations: number; meteredByService: Record<string, number>; attempts: number; commit: () => void } {
  const open = sidecars(dir, (n) => n.startsWith(`${placementId}-a`)).filter((f) => f.value.placement === placementId && !f.value.charged);
  const metered = open.reduce((sum, f) => sum + (f.value.meteredUsd ?? 0), 0);
  return {
    generations: open.reduce((sum, f) => sum + f.value.generations, 0),
    meteredByService: metered > 0 ? { [METERED_VENDOR]: Math.round(metered * 1e4) / 1e4 } : {},
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

export const attemptStem = (dir: string, placementId: string, n: number) => `${dir}/${placementId}-a${n}`;

export const sidecarOf = (png: string) => png.replace(/\.png$/, ".json");

export function attemptNumbers(dir: string, placementId: string): number[] {
  const prefix = `${placementId}-a`;
  return readdirSync(dir)
    .filter((n) => n.startsWith(prefix))
    .map((n) => n.slice(prefix.length).match(/^(\d+)\.(png|json)$/)?.[1])
    .filter((n) => n !== undefined)
    .map(Number);
}

function createExclusive(path: string, data: Uint8Array): boolean {
  try {
    writeFileSync(path, data, { flag: "wx" });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

export const attemptTaken = (dir: string, placementId: string, n: number) =>
  `Attempt ${n} of ${basename(dir)}/${placementId} is already in scratch; leave out --attempt to take the next free number`;

// The PNG is created exclusively, so parallel runs never write over each other's Attempt and lose its generations.
export function claimAttempt(dir: string, placementId: string, wanted: number | null, png: Uint8Array): number {
  for (let n = wanted ?? 1 + Math.max(0, ...attemptNumbers(dir, placementId)); ; n++) {
    const stem = attemptStem(dir, placementId, n);
    if (!existsSync(`${stem}.json`) && createExclusive(`${stem}.png`, png)) return n;
    if (wanted !== null) throw new Error(attemptTaken(dir, placementId, n));
  }
}

const ELEMENTS = "library/elements";

export function freeElementId(proposed: string): string {
  const m = proposed.match(/^(.*)-(\d+)$/)!;
  const taken = (id: string) => existsSync(join(ELEMENTS, `${id}.json`)) || existsSync(join(ELEMENTS, `${id}.png`));
  let n = Number(m[2]);
  let id = proposed;
  while (taken(id)) id = `${m[1]}-${String(++n).padStart(m[2].length, "0")}`;
  return id;
}

export const rawPlacement = (raw: any, id: string) => raw.layers.flatMap((l: any) => l.placements ?? []).find((p: any) => p.id === id);
