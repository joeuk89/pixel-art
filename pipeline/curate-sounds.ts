import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  crossfadeLoop, cutOneShot, decodeToWav, encodeOgg, normalise, normalisedTo, pickRegion, readWav, seamReport, writeWav, type Wav,
} from "./lib/audio.ts";
import { downloadPreview, getSound, isCc0 } from "./lib/freesound.ts";

const OUT_DIR = "library/ambient";
// Freesound allows 60 requests a minute.
const PAUSE_MS = 600;

const entrySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  sourceId: z.number().int().positive(),
  kind: z.enum(["loop", "oneshot"]),
  distance: z.array(z.enum(["near", "mid", "far"])).min(1),
  subject: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
  method: z.enum(["whole", "crossfade", "cut"]),
  targetSec: z.number().positive().optional(),
  fadeSec: z.number().positive().optional(),
  note: z.string().min(1).optional(),
});
type Entry = z.infer<typeof entrySchema>;

function shape(entry: Entry, src: Wav): { out: Wav; processing: Record<string, unknown> } {
  if (entry.method === "crossfade") {
    const fade = entry.fadeSec ?? 3;
    const { start, end, cost } = pickRegion(src, entry.targetSec ?? 45, fade);
    const out = crossfadeLoop(src, start, end, fade);
    return {
      out,
      processing: {
        method: "crossfade", regionStartSec: +(start / src.rate).toFixed(2), regionEndSec: +(end / src.rate).toFixed(2),
        fadeSec: fade, pickCost: +cost.toFixed(4), ...seamReport(out),
      },
    };
  }
  if (entry.method === "cut") {
    const fade = entry.fadeSec ?? 0.5;
    return { out: cutOneShot(src, entry.targetSec, fade), processing: { method: "cut", maxSec: entry.targetSec ?? null, fadeOutSec: fade } };
  }
  return { out: src, processing: { method: "whole", ...seamReport(src) } };
}

async function curate(entry: Entry, work: string, today: string) {
  const meta = await getSound(entry.sourceId);
  if (!isCc0(meta)) throw new Error(`${entry.id}: licence is ${meta.license}, not CC0`);
  const ogg = join(work, `${entry.sourceId}.ogg`), wav = join(work, `${entry.sourceId}.wav`);
  writeFileSync(ogg, await downloadPreview(meta));
  decodeToWav(ogg, wav);
  const { out, processing } = shape(entry, readWav(wav));
  const norm = normalise(out, entry.kind);
  const outWav = join(work, `${entry.id}.wav`);
  writeWav(outWav, out);
  encodeOgg(outWav, join(OUT_DIR, `${entry.id}.ogg`));
  const record = {
    id: entry.id, kind: entry.kind, distance: entry.distance, subject: entry.subject, tags: entry.tags,
    source: "freesound", sourceId: entry.sourceId, sourceUrl: meta.url, sourceName: meta.name, author: meta.username,
    licence: "CC0-1.0", licenceUrl: meta.license,
    attribution: `"${meta.name}" by ${meta.username} on Freesound, CC0`,
    file: `${entry.id}.ogg`, durationSec: +(out.data[0].length / out.rate).toFixed(3), sampleRate: out.rate, channels: out.ch,
    processing: {
      from: "preview-hq-ogg", sourceDurationSec: +meta.duration.toFixed(1), sourceType: meta.type, ...processing,
      normalisedTo: normalisedTo(entry.kind), ...norm,
    },
    fetchedAt: today, ...(entry.note ? { note: entry.note } : {}),
  };
  writeFileSync(join(OUT_DIR, `${entry.id}.json`), JSON.stringify(record, null, 2) + "\n");
  return { id: entry.id, file: `${OUT_DIR}/${record.file}`, record: `${OUT_DIR}/${entry.id}.json`, durationSec: record.durationSec, channels: out.ch, gainDb: norm.gainDb, processing };
}

const written: Awaited<ReturnType<typeof curate>>[] = [];
const skipped: string[] = [];
const work = mkdtempSync(join(tmpdir(), "curate-sounds-"));
try {
  const [specPath] = process.argv.slice(2);
  if (!specPath) throw new Error("usage: curate-sounds <spec.json>");
  const entries = z.array(entrySchema).parse(JSON.parse(readFileSync(specPath, "utf8")));
  mkdirSync(OUT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  for (const [i, entry] of entries.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
    written.push(await curate(entry, work, today));
  }
  process.stdout.write(JSON.stringify({ ok: true, written, skipped }, null, 2) + "\n");
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: (e as Error).message, written, skipped }, null, 2) + "\n");
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
