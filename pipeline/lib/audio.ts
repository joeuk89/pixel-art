import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

export type Wav = { rate: number; ch: number; data: Float32Array[] };
export type SoundKind = "loop" | "oneshot";

export const LOOP_RMS_DBFS = -20;
export const ONESHOT_PEAK_DBFS = -6;
// A near-silent recording lifted further only amplifies encoder noise.
export const MAX_LIFT_DB = 30;
export const SAMPLE_RATE = 48000;

const ffmpeg = process.env.FFMPEG ?? (ffmpegPath as unknown as string);

export function decodeToWav(input: string, output: string): void {
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", input, "-ar", String(SAMPLE_RATE), "-sample_fmt", "s16", output]);
}

export function encodeOgg(input: string, output: string): void {
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", input, "-codec:a", "libvorbis", "-q:a", "5", output]);
}

export function readWav(path: string): Wav {
  const b = readFileSync(path);
  let p = 12, rate = 0, ch = 0, bits = 0, data: Buffer | null = null;
  while (p < b.length) {
    const id = b.toString("ascii", p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === "fmt ") { ch = b.readUInt16LE(p + 10); rate = b.readUInt32LE(p + 12); bits = b.readUInt16LE(p + 22); }
    if (id === "data") { data = b.subarray(p + 8, p + 8 + size); break; }
    p += 8 + size + (size & 1);
  }
  if (!data || bits !== 16) throw new Error(`${path}: need 16-bit PCM`);
  const n = Math.floor(data.length / 2 / ch), out = Array.from({ length: ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) out[c][i] = data.readInt16LE((i * ch + c) * 2) / 32768;
  return { rate, ch, data: out };
}

export function writeWav(path: string, w: Wav): void {
  const n = w.data[0].length, b = Buffer.alloc(44 + n * w.ch * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * w.ch * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(w.ch, 22); b.writeUInt32LE(w.rate, 24); b.writeUInt32LE(w.rate * w.ch * 2, 28);
  b.writeUInt16LE(w.ch * 2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * w.ch * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < w.ch; c++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(w.data[c][i] * 32767))), 44 + (i * w.ch + c) * 2);
  writeFileSync(path, b);
}

function mono(w: Wav, i: number): number {
  let s = 0;
  for (const c of w.data) s += c[i];
  return s / w.ch;
}

function envelope(w: Wav): { env: Float32Array; hop: number } {
  const hop = Math.round(w.rate * 0.05), n = Math.floor(w.data[0].length / hop), env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) { const m = mono(w, j); s += m * m; }
    env[i] = Math.sqrt(s / hop);
  }
  return { env, hop };
}

// Picks a region whose head matches its tail and whose level is steady,
// so a ramping recording (a kettle coming to the boil) is avoided.
export function pickRegion(w: Wav, targetSec: number, fadeSec: number): { start: number; end: number; cost: number } {
  const { env, hop } = envelope(w), hps = 20;
  const cmp = Math.round(fadeSec * hps), margin = Math.round(1 * hps);
  const minLen = Math.round(targetSec * 0.9 * hps), maxLen = Math.round(targetSec * hps);
  let best = { cost: Infinity, s: 0, e: 0 };
  for (let s = margin; s + minLen + cmp < env.length - margin; s += 10) {
    for (let e = s + minLen; e <= s + maxLen && e + cmp < env.length - margin; e += 10) {
      let seam = 0;
      for (let k = 0; k < cmp; k++) seam += Math.abs(env[s + k] - env[e + k]);
      seam /= cmp;
      let mean = 0;
      for (let k = s; k < e; k++) mean += env[k];
      mean /= e - s;
      let varSum = 0;
      for (let k = s; k < e; k++) varSum += (env[k] - mean) ** 2;
      const steadiness = Math.sqrt(varSum / (e - s)) / (mean + 1e-6);
      const cost = seam / (mean + 1e-6) + 0.5 * steadiness;
      if (cost < best.cost) best = { cost, s, e };
    }
  }
  if (!isFinite(best.cost)) throw new Error(`source is too short for a ${targetSec} s loop`);
  return { start: best.s * hop, end: best.e * hop, cost: best.cost };
}

export function crossfadeLoop(w: Wav, start: number, end: number, fadeSec: number): Wav {
  const x = Math.min(Math.round(fadeSec * w.rate), w.data[0].length - end);
  const data = w.data.map((c) => {
    const body = c.slice(start, end), tail = c.slice(end, end + x);
    for (let i = 0; i < x; i++) {
      const t = i / x;
      body[i] = body[i] * Math.sin((t * Math.PI) / 2) + tail[i] * Math.cos((t * Math.PI) / 2);
    }
    return body;
  });
  return { rate: w.rate, ch: w.ch, data };
}

// Keeps from just before the first onset to at most maxSec, trims trailing silence, fades both ends.
export function cutOneShot(w: Wav, maxSec: number | undefined, fadeOutSec: number): Wav {
  const { env, hop } = envelope(w);
  const peak = Math.max(...env), gate = peak * 0.05;
  let first = env.findIndex((v) => v > gate);
  if (first < 0) first = 0;
  let last = env.length - 1;
  while (last > first && env[last] < gate) last--;
  const start = Math.max(0, first * hop - Math.round(0.25 * w.rate));
  let end = Math.min(w.data[0].length, (last + 1) * hop + Math.round(0.5 * w.rate));
  if (maxSec) end = Math.min(end, start + Math.round(maxSec * w.rate));
  const fin = Math.round(0.01 * w.rate), fout = Math.min(Math.round(fadeOutSec * w.rate), end - start);
  const data = w.data.map((c) => {
    const s = c.slice(start, end), n = s.length;
    for (let i = 0; i < fin; i++) s[i] *= i / fin;
    for (let i = 0; i < fout; i++) s[n - 1 - i] *= i / fout;
    return s;
  });
  return { rate: w.rate, ch: w.ch, data };
}

export function normalise(w: Wav, kind: SoundKind): { gainDb: number } {
  let sq = 0, peak = 0;
  const n = w.data[0].length;
  for (let i = 0; i < n; i++) {
    const m = mono(w, i);
    sq += m * m;
    for (const c of w.data) peak = Math.max(peak, Math.abs(c[i]));
  }
  const rms = Math.sqrt(sq / n);
  let gain = kind === "loop" ? 10 ** (LOOP_RMS_DBFS / 20) / rms : 10 ** (ONESHOT_PEAK_DBFS / 20) / peak;
  gain = Math.min(gain, 0.98 / peak, 10 ** (MAX_LIFT_DB / 20));
  for (const c of w.data) for (let i = 0; i < n; i++) c[i] *= gain;
  return { gainDb: +(20 * Math.log10(gain)).toFixed(1) };
}

export function normalisedTo(kind: SoundKind): string {
  return kind === "loop" ? `${LOOP_RMS_DBFS} dBFS RMS` : `${ONESHOT_PEAK_DBFS} dBFS peak`;
}

export function seamReport(w: Wav): { seamJump: number; maxInnerJump: number } {
  const c = w.data[0], n = c.length;
  let maxInner = 0;
  for (let i = 1; i < n; i++) maxInner = Math.max(maxInner, Math.abs(c[i] - c[i - 1]));
  return { seamJump: +Math.abs(c[0] - c[n - 1]).toFixed(4), maxInnerJump: +maxInner.toFixed(4) };
}
