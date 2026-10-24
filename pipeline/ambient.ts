import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readScene, readSounds } from "./lib/library.ts";

const AMBIENT = "library/ambient";

type Report = { slot: string; file: string; source: "curated" | "generated"; action: "copied" };

async function run(planPath: string) {
  const plan = readScene(planPath);
  const sounds = new Map(readSounds().map((s) => [s.id, s]));
  const sceneDir = dirname(planPath);
  const slots = [
    ...plan.soundtrack.ambient.map((entry, i) => ({ entry, slot: `soundtrack.ambient[${i}]`, kind: "loop" as const })),
    ...plan.soundtrack.oneshots.map((entry, i) => ({ entry, slot: `soundtrack.oneshots[${i}]`, kind: "oneshot" as const })),
  ];
  for (const { entry, slot, kind } of slots) {
    if (entry.source.kind !== "curated") continue;
    const record = sounds.get(entry.source.id);
    if (!record) throw new Error(`${planPath}: ${slot}.source.id: Sound library has no record ${entry.source.id}`);
    if (record.kind !== kind) throw new Error(`${planPath}: ${slot}.source.id: ${record.id} is a ${record.kind}, not a ${kind}`);
  }
  const entries: Report[] = [];
  for (const { entry, slot } of slots) {
    if (entry.source.kind !== "curated") continue;
    const record = sounds.get(entry.source.id)!;
    copyFileSync(join(AMBIENT, record.file), join(sceneDir, entry.file));
    entries.push({ slot, file: entry.file, source: "curated", action: "copied" });
  }
  return { scene: plan.id, entries };
}

try {
  const [planPath, ...rest] = process.argv.slice(2);
  if (!planPath || rest.length > 0) throw new Error("usage: ambient <scene.json>");
  process.stdout.write(JSON.stringify({ ok: true, ...(await run(planPath)) }, null, 2) + "\n");
} catch (e) {
  const error = (e as Error).message;
  process.stderr.write(error + "\n");
  process.stdout.write(JSON.stringify({ ok: false, error }, null, 2) + "\n");
  process.exitCode = 1;
}
