import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { MUSIC_FILE, scenePlanSchema } from "../schema/index.ts";
import { decodeToWav, decodedSampleCount, encodeMp3, readWav, writeWav } from "./lib/audio.ts";
import { main } from "./lib/cli.ts";
import { makeMusicLoop, seamPasses } from "./lib/music-loop.ts";
import { lyria, stableAudio } from "./lib/music-services.ts";

const REQUEST_SEC = 135;
const COST_USD = 0.08;
const MP3_FRAME_SAMPLES = 1152;
const MAX_SEED = 4294967295;
const LOOP_WORDING =
  "Instrumental only, no vocals, no singing. Steady texture throughout. " +
  "No intro, no outro, no build-up, constant mood from start to end so it can loop.";

const generators = {
  "stable-audio-3": { costKey: "stability", generate: (prompt: string, seed: number) => stableAudio(prompt, REQUEST_SEC, seed % MAX_SEED) },
  lyria: { costKey: "gemini", generate: lyria },
};

main(async () => {
  const args = process.argv.slice(2);
  const [arg, ...extra] = args.filter((a) => !a.startsWith("--"));
  const unknown = args.filter((a) => a.startsWith("--") && a !== "--lyria" && a !== "--force");
  if (!arg || extra.length || unknown.length) throw new Error("usage: music <scene.json> [--lyria] [--force]");
  const planPath = resolve(arg);
  const dir = dirname(planPath);
  const raw = JSON.parse(readFileSync(planPath, "utf8"));
  const plan = scenePlanSchema.parse(raw);
  const music = plan.soundtrack.music;
  const file = music.file ?? MUSIC_FILE;
  const out = join(dir, file);
  const writePlan = () => writeFileSync(planPath, JSON.stringify(raw, null, 2) + "\n");

  if (!args.includes("--force") && music.file && music.loopEnd !== undefined && music.seam && existsSync(out)) {
    return { scene: plan.id, skipped: true, file: relative(process.cwd(), out), loopEnd: music.loopEnd, seam: music.seam };
  }

  const serviceName = args.includes("--lyria") ? "lyria" : "stable-audio-3";
  const { costKey, generate } = generators[serviceName];
  const prompt = `${music.brief.replace(/[.\s]+$/, "")}. ${LOOP_WORDING}`;
  const bytes = await generate(prompt, Math.abs(plan.seed));
  raw.cost.meteredUsd[costKey] = +((raw.cost.meteredUsd[costKey] ?? 0) + COST_USD).toFixed(4);
  writePlan();

  const work = mkdtempSync(join(tmpdir(), "music-"));
  try {
    writeFileSync(join(work, "source"), bytes);
    decodeToWav(join(work, "source"), join(work, "source.wav"));
    const source = readWav(join(work, "source.wav"));
    const made = makeMusicLoop(source);
    if (!seamPasses(made.seam)) {
      throw new Error(`seam jump ${made.seam.seamJump} exceeds the largest step inside the loop (${made.seam.maxInnerJump}); rerun with --force`);
    }
    writeWav(join(work, "loop.wav"), made.loop);
    encodeMp3(join(work, "loop.wav"), out);
    const decoded = decodedSampleCount(out);
    if (Math.abs(decoded - made.loopSamples) > MP3_FRAME_SAMPLES) {
      throw new Error(`${file} decodes to ${decoded} samples, the loop has ${made.loopSamples}`);
    }
    const loopEnd = +(made.loopSamples / source.rate).toFixed(6);
    raw.soundtrack.music = {
      brief: music.brief, service: serviceName, file, loopStart: 0, loopEnd, seam: made.seam, gain: music.gain,
    };
    writePlan();
    return {
      scene: plan.id, service: serviceName, prompt, file: relative(process.cwd(), out), loopStart: 0, loopEnd, seam: made.seam,
      regionStartSec: made.regionStartSec, regionEndSec: made.regionEndSec, pickCost: made.pickCost, costUsd: { [costKey]: COST_USD },
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
