import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import type { AmbientLoopRecord, ScenePlan } from "../schema/index.ts";
import { decodeToWav, encodeOgg, normalise, normaliseTarget, readWav, writeWav, type SoundKind } from "./lib/audio.ts";
import { generateSoundEffect, SOUND_EFFECTS_MODEL, USD_PER_SECOND } from "./lib/fal.ts";
import { readScene, readSounds } from "./lib/library.ts";

const AMBIENT = "library/ambient";
const METERED_SERVICE = "fal";

type Entry = ScenePlan["soundtrack"]["ambient"][number];
type Slot = { entry: Entry; list: "ambient" | "oneshots"; index: number; slot: string; kind: SoundKind };
type Report = {
  slot: string; file: string; source: "curated" | "generated"; action: "copied" | "generated" | "kept";
  record: string; costUsd?: number; rmsDbfs?: number; peakDbfs?: number;
};

const roundUsd = (n: number) => Math.round(n * 1e4) / 1e4;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "sound";

const subjectOf = (entry: Entry) => basename(entry.file, extname(entry.file)).replace(/[-_]+/g, " ");

function newRecordId(subject: string, taken: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `elevenlabs-${slug(subject)}-${String(n).padStart(2, "0")}`;
    if (!taken.has(id) && !existsSync(join(AMBIENT, `${id}.json`))) return id;
  }
}

async function generate(slot: Slot, brief: string, id: string, work: string) {
  const loop = slot.kind === "loop";
  const effect = await generateSoundEffect({ text: brief, loop });
  const raw = join(work, `${id}.src`), wav = join(work, `${id}.wav`);
  writeFileSync(raw, effect.bytes);
  decodeToWav(raw, wav);
  const sound = readWav(wav);
  const sourceSec = sound.data[0].length / sound.rate;
  const costUsd = roundUsd(sourceSec * USD_PER_SECOND);
  const norm = normalise(sound, slot.kind);
  writeWav(wav, sound);
  encodeOgg(wav, join(AMBIENT, `${id}.ogg`));
  const subject = subjectOf(slot.entry);
  const record: AmbientLoopRecord = {
    id, kind: slot.kind, distance: [slot.entry.distance], subject, tags: [subject],
    source: METERED_SERVICE, sourceId: effect.requestId, sourceUrl: effect.audioUrl,
    sourceName: "ElevenLabs Sound Effects v2", author: "ElevenLabs via fal.ai",
    licence: "fal.ai Terms of Service, commercial use", licenceUrl: "https://fal.ai/terms",
    attribution: "Generated with ElevenLabs Sound Effects v2 via fal.ai",
    file: `${id}.ogg`, durationSec: +sourceSec.toFixed(3), sampleRate: sound.rate, channels: sound.ch,
    processing: { method: "generated", model: SOUND_EFFECTS_MODEL, params: effect.params, costUsd, target: normaliseTarget(slot.kind), ...norm },
    fetchedAt: new Date().toISOString().slice(0, 10),
    brief,
  };
  writeFileSync(join(AMBIENT, `${id}.json`), JSON.stringify(record, null, 2) + "\n");
  return { record, costUsd, norm };
}

async function run(planPath: string, work: string) {
  const plan = readScene(planPath);
  const sounds = new Map(readSounds().map((s) => [s.id, s]));
  const sceneDir = dirname(planPath);
  const slots: Slot[] = [
    ...plan.soundtrack.ambient.map((entry, index) => ({ entry, list: "ambient" as const, index, slot: `soundtrack.ambient[${index}]`, kind: "loop" as const })),
    ...plan.soundtrack.oneshots.map((entry, index) => ({ entry, list: "oneshots" as const, index, slot: `soundtrack.oneshots[${index}]`, kind: "oneshot" as const })),
  ];
  for (const { entry, slot, kind } of slots) {
    if (entry.source.kind !== "curated") continue;
    const record = sounds.get(entry.source.id);
    if (!record) throw new Error(`${planPath}: ${slot}.source.id: Sound library has no record ${entry.source.id}`);
    if (record.kind !== kind) throw new Error(`${planPath}: ${slot}.source.id: ${record.id} is a ${record.kind}, not a ${kind}`);
  }

  const entries: Report[] = [];
  const taken = new Set(sounds.keys());
  for (const slot of slots) {
    const { entry } = slot;
    if (entry.source.kind === "curated") {
      const record = sounds.get(entry.source.id)!;
      copyFileSync(join(AMBIENT, record.file), join(sceneDir, entry.file));
      entries.push({ slot: slot.slot, file: entry.file, source: "curated", action: "copied", record: record.id });
      continue;
    }
    const existing = entry.source.id ? sounds.get(entry.source.id) : undefined;
    if (existing) {
      const beside = join(sceneDir, entry.file);
      const action = existsSync(beside) ? "kept" : "copied";
      if (action === "copied") copyFileSync(join(AMBIENT, existing.file), beside);
      entries.push({ slot: slot.slot, file: entry.file, source: "generated", action, record: existing.id });
      continue;
    }
    const id = newRecordId(subjectOf(entry), taken);
    taken.add(id);
    const { record, costUsd, norm } = await generate(slot, entry.source.brief, id, work);
    copyFileSync(join(AMBIENT, record.file), join(sceneDir, entry.file));
    const raw = JSON.parse(readFileSync(planPath, "utf8"));
    raw.soundtrack[slot.list][slot.index].source.id = id;
    raw.cost.meteredUsd[METERED_SERVICE] = roundUsd((raw.cost.meteredUsd[METERED_SERVICE] ?? 0) + costUsd);
    writeFileSync(planPath, JSON.stringify(raw, null, 2) + "\n");
    entries.push({ slot: slot.slot, file: entry.file, source: "generated", action: "generated", record: id, costUsd, rmsDbfs: norm.rmsDbfs, peakDbfs: norm.peakDbfs });
  }
  return { scene: plan.id, entries, costUsd: roundUsd(entries.reduce((sum, e) => sum + (e.costUsd ?? 0), 0)) };
}

const work = mkdtempSync(join(tmpdir(), "ambient-"));
try {
  const [planPath, ...rest] = process.argv.slice(2);
  if (!planPath || rest.length > 0) throw new Error("usage: ambient <scene.json>");
  process.stdout.write(JSON.stringify({ ok: true, ...(await run(planPath, work)) }, null, 2) + "\n");
} catch (e) {
  const error = (e as Error).message;
  process.stderr.write(error + "\n");
  process.stdout.write(JSON.stringify({ ok: false, error }, null, 2) + "\n");
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
