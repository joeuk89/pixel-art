// PROTOTYPE, throwaway. Generates one ambient track from the same brief with
// Stable Audio 3.0 and Lyria 3.5. Run: npm run generate [stable|lyria]
// Writes out/stable.raw.wav and out/lyria.raw.wav plus timing notes.
import { writeFileSync, mkdirSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";

const BRIEF =
  "Instrumental only, no vocals, no singing. Soft, slow, cosy ambient piano with a warm pad underneath, " +
  "for rain on a window at night. Sparse, gentle, lo-fi, steady texture throughout. " +
  "No intro, no outro, no build-up, no drums, no melody hooks, constant mood from start to end so it can loop.";

const REQUEST_SECONDS = 135; // 120 s loop + crossfade + trim margin

mkdirSync("out", { recursive: true });

async function stable() {
  const key = process.env.STABILITY_API_KEY!;
  const form = new FormData();
  form.set("prompt", BRIEF);
  form.set("duration", String(REQUEST_SECONDS));
  form.set("output_format", "wav");
  form.set("seed", "7");
  const t0 = Date.now();
  const r = await fetch("https://api.stability.ai/v2beta/audio/stable-audio/text-to-audio", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    body: form,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`stable submit HTTP ${r.status}: ${text}`);
  const { id } = JSON.parse(text) as { id: string };
  console.log(`stable: submitted ${id}`);
  for (;;) {
    await new Promise((res) => setTimeout(res, 5000));
    const p = await fetch(`https://api.stability.ai/v2beta/audio/results/${id}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "audio/*" },
    });
    if (p.status === 202) {
      process.stdout.write(".");
      continue;
    }
    if (!p.ok) throw new Error(`stable poll HTTP ${p.status}: ${await p.text()}`);
    const bytes = new Uint8Array(await p.arrayBuffer());
    writeFileSync("out/stable.raw.wav", bytes);
    console.log(`\nstable: ${bytes.length} bytes in ${((Date.now() - t0) / 1000).toFixed(0)} s -> out/stable.raw.wav`);
    return;
  }
}

async function lyria() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const t0 = Date.now();
  const res = await ai.interactions.create({
    model: "lyria-3.5",
    input: `${BRIEF} Make it about 2 minutes and 15 seconds long.`,
    response_format: { type: "audio", mime_type: "audio/wav" },
  });
  const audio = res.output_audio;
  if (!audio?.data) throw new Error(`lyria: no audio in response: ${JSON.stringify(res).slice(0, 500)}`);
  const bytes = Buffer.from(audio.data, "base64");
  const ext = audio.mime_type?.includes("wav") ? "wav" : "mp3";
  writeFileSync(`out/lyria.raw.${ext}`, bytes);
  console.log(
    `lyria: ${bytes.length} bytes, ${audio.mime_type} ${audio.sample_rate ?? "?"} Hz ${audio.channels ?? "?"} ch in ${((Date.now() - t0) / 1000).toFixed(0)} s -> out/lyria.raw.${ext}`,
  );
}

const which = process.argv[2];
const jobs = [];
if (!which || which === "stable") jobs.push(stable().catch((e) => console.error(String(e))));
if (!which || which === "lyria") jobs.push(lyria().catch((e) => console.error(String(e))));
await Promise.all(jobs);
