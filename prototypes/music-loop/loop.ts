// PROTOTYPE, throwaway. Method A loop-maker: pick a loop region of a raw WAV where
// the head resembles the tail, crossfade the tail into the head (equal power),
// write a WAV, encode MP3 and Opus with ffmpeg-static, and record loop points.
// Run: npm run loop  (reads out/*.raw.wav, writes out/<name>.x<fade>.{wav,mp3,opus} and out/manifest.json)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";

type Wav = { rate: number; ch: number; data: Float32Array[] };

function readWav(path: string): Wav {
  const b = readFileSync(path);
  let p = 12, rate = 0, ch = 0, bits = 0, data: Buffer | null = null;
  while (p < b.length) {
    const id = b.toString("ascii", p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === "fmt ") { ch = b.readUInt16LE(p + 10); rate = b.readUInt32LE(p + 12); bits = b.readUInt16LE(p + 22); }
    if (id === "data") { data = b.subarray(p + 8, p + 8 + size); break; }
    p += 8 + size + (size & 1);
  }
  if (!data || bits !== 16) throw new Error(`${path}: need 16-bit PCM`);
  const n = data.length / 2 / ch, out = Array.from({ length: ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) out[c][i] = data.readInt16LE((i * ch + c) * 2) / 32768;
  return { rate, ch, data: out };
}

function writeWav(path: string, w: Wav) {
  const n = w.data[0].length, b = Buffer.alloc(44 + n * w.ch * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * w.ch * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(w.ch, 22); b.writeUInt32LE(w.rate, 24); b.writeUInt32LE(w.rate * w.ch * 2, 28);
  b.writeUInt16LE(w.ch * 2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * w.ch * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < w.ch; c++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(w.data[c][i] * 32767))), 44 + (i * w.ch + c) * 2);
  writeFileSync(path, b);
}

// Envelope in 50 ms hops, mono. Used to find a region whose start sounds like its end.
function envelope(w: Wav, hop: number) {
  const n = Math.floor(w.data[0].length / hop), e = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * hop; j < (i + 1) * hop; j++) { const m = (w.data[0][j] + w.data[w.ch - 1][j]) / 2; s += m * m; } e[i] = Math.sqrt(s / hop); }
  return e;
}

function pickRegion(w: Wav, fade: number, targetLen: number) {
  const hop = Math.round(w.rate * 0.05), env = envelope(w, hop), hps = 1 / 0.05;
  const trim = Math.round(8 * hps), cmp = Math.round(fade * hps); // compare `fade` seconds after S with `fade` seconds after E
  let best = { cost: Infinity, s: 0, e: 0 };
  for (let s = trim; s < trim + Math.round(15 * hps); s++) {
    for (let e = s + Math.round((targetLen - 10) * hps); e <= s + Math.round(targetLen * hps); e++) {
      if (e + cmp >= env.length - trim) break;
      let cost = 0;
      for (let k = 0; k < cmp; k++) cost += Math.abs(env[s + k] - env[e + k]);
      cost = cost / cmp + 0.5 * (env[s] + env[e]); // prefer similar envelopes and quiet seams
      if (cost < best.cost) best = { cost, s, e };
    }
  }
  return { start: best.s * hop, end: best.e * hop, cost: best.cost };
}

function makeLoop(w: Wav, start: number, end: number, fadeSec: number): Wav {
  const X = Math.round(fadeSec * w.rate), len = end - start;
  const data = w.data.map((c) => {
    const body = c.slice(start, end), tail = c.slice(end, end + X);
    for (let i = 0; i < X; i++) { const t = i / X; body[i] = body[i] * Math.sin(t * Math.PI / 2) + tail[i] * Math.cos(t * Math.PI / 2); }
    return body;
  });
  return { rate: w.rate, ch: w.ch, data };
}

// Largest sample-to-sample jump at the seam when the loop repeats, versus the typical jump inside the loop.
function seamReport(w: Wav) {
  const c = w.data[0], n = c.length;
  let maxInner = 0; for (let i = 1; i < n; i++) maxInner = Math.max(maxInner, Math.abs(c[i] - c[i - 1]));
  const seam = Math.abs(c[0] - c[n - 1]);
  return { seamJump: +seam.toFixed(4), maxInnerJump: +maxInner.toFixed(4) };
}

const manifest: Record<string, unknown> = existsSync("out/manifest.json") ? JSON.parse(readFileSync("out/manifest.json", "utf8")) : {};
const jobs: [string, number][] = [["stable", 4], ["lyria", 4], ["stable", 2], ["stable", 8]];
for (const [name, fade] of jobs) {
  const src = `out/${name}.raw.wav`;
  if (!existsSync(src)) { console.log(`skip ${src}`); continue; }
  const w = readWav(src);
  const { start, end, cost } = pickRegion(w, fade, 115);
  const loop = makeLoop(w, start, end, fade);
  const base = `out/${name}.x${fade}`;
  writeWav(`${base}.wav`, loop);
  execFileSync(ffmpeg!, ["-y", "-loglevel", "error", "-i", `${base}.wav`, "-codec:a", "libmp3lame", "-b:a", "192k", `${base}.mp3`]);
  execFileSync(ffmpeg!, ["-y", "-loglevel", "error", "-i", `${base}.wav`, "-codec:a", "libopus", "-b:a", "96k", `${base}.opus`]);
  const info = { method: "A", source: src, rate: w.rate, fadeSec: fade, regionStartSec: +(start / w.rate).toFixed(3), regionEndSec: +(end / w.rate).toFixed(3), loopSamples: end - start, loopSec: +((end - start) / w.rate).toFixed(3), pickCost: +cost.toFixed(5), ...seamReport(loop) };
  manifest[`${name}.x${fade}`] = info;
  console.log(`${name}.x${fade}:`, JSON.stringify(info));
}
writeFileSync("out/manifest.json", JSON.stringify(manifest, null, 2));
