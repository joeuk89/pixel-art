// PROTOTYPE, throwaway. Method B: rotate the Stable Audio loop region so the seam sits
// mid-file, ask Stable Audio 3.0 inpaint to recompose 12 s around it, rotate back.
// Run: node --env-file=../../.env inpaint.ts   (costs 8 Stability credits)
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";

const key = process.env.STABILITY_API_KEY!;
const m = JSON.parse(readFileSync("out/manifest.json", "utf8"));
const { regionStartSec: S, regionEndSec: E, loopSec } = m["stable.x4"];
const prompt = "Instrumental only, no vocals. Soft slow cosy ambient piano with a warm pad, rain on a window at night, sparse, gentle, lo-fi, steady texture.";
const half = loopSec / 2;

// rotated = raw[S+half, E) + raw[S, S+half): seam at `half`
execFileSync(ffmpeg!, ["-y", "-loglevel", "error", "-i", "out/stable.raw.wav", "-filter_complex",
  `[0:a]atrim=start=${S + half}:end=${E},asetpts=PTS-STARTPTS[a];[0:a]atrim=start=${S}:end=${S + half},asetpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=0:a=1[out]`,
  "-map", "[out]", "out/stable.rotated.wav"]);

const form = new FormData();
form.set("prompt", prompt);
form.set("mask_start", String((half - 6).toFixed(2)));
form.set("mask_end", String((half + 6).toFixed(2)));
form.set("output_format", "wav");
form.set("seed", "7");
form.set("duration", String(loopSec)); // unverified: the first run without it returned the 190 s default
form.set("audio", new Blob([readFileSync("out/stable.rotated.wav")], { type: "audio/wav" }), "rotated.wav");
const t0 = Date.now();
const r = await fetch("https://api.stability.ai/v2beta/audio/stable-audio/inpaint", {
  method: "POST", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, body: form,
});
const text = await r.text();
if (!r.ok) throw new Error(`inpaint submit HTTP ${r.status}: ${text}`);
const { id } = JSON.parse(text);
console.log("inpaint submitted", id);
for (;;) {
  await new Promise((res) => setTimeout(res, 5000));
  const p = await fetch(`https://api.stability.ai/v2beta/audio/results/${id}`, { headers: { Authorization: `Bearer ${key}`, Accept: "audio/*" } });
  if (p.status === 202) { process.stdout.write("."); continue; }
  if (!p.ok) throw new Error(`poll HTTP ${p.status}: ${await p.text()}`);
  writeFileSync("out/stable.inpainted.wav", new Uint8Array(await p.arrayBuffer()));
  break;
}
console.log(`\ninpaint done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
// rotate back: inpainted[half, end) + inpainted[0, half)
execFileSync(ffmpeg!, ["-y", "-loglevel", "error", "-i", "out/stable.inpainted.wav", "-filter_complex",
  `[0:a]atrim=start=${half},asetpts=PTS-STARTPTS[a];[0:a]atrim=start=0:end=${half},asetpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=0:a=1[out]`,
  "-map", "[out]", "out/stable.inpaint.wav"]);
for (const [codec, ext, br] of [["libmp3lame", "mp3", "192k"], ["libopus", "opus", "96k"]])
  execFileSync(ffmpeg!, ["-y", "-loglevel", "error", "-i", "out/stable.inpaint.wav", "-codec:a", codec, "-b:a", br, `out/stable.inpaint.${ext}`]);
m["stable.inpaint"] = { method: "B", source: "out/stable.raw.wav", fadeSec: 0, regionStartSec: S, regionEndSec: E, loopSec, maskSec: 12, note: "seam recomposed by Stable Audio inpaint" };
writeFileSync("out/manifest.json", JSON.stringify(m, null, 2));
