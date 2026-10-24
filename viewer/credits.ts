import { allPlacements, ambientLoopRecordSchema, elementRecordSchema, sceneSounds, type AmbientLoopRecord, type ScenePlan } from "../schema/index.ts";
import { fetchJson } from "./http.ts";

const SERVICE_NAMES: Record<string, string> = {
  pixellab: "PixelLab",
  "retro-diffusion": "Retro Diffusion",
  "stable-audio-3": "Stable Audio 3.0",
  lyria: "Lyria",
  elevenlabs: "ElevenLabs",
  "elevenlabs-fal": "ElevenLabs",
  fal: "fal.ai",
};

const LOCAL_FINISH = "local";

export const AI_NOTICE = "Artwork, music and sound effects generated with AI.";

export type Attribution = Pick<AmbientLoopRecord, "attribution" | "licence" | "licenceUrl" | "sourceUrl">;
export type Credits = { services: string[]; attributions: Attribution[] };

function serviceName(service: string): string {
  return SERVICE_NAMES[service] ?? service;
}

export async function loadCredits(root: URL, plan: ScenePlan): Promise<Credits> {
  const elementIds = new Set(allPlacements(plan).map((p) => p.element));
  const sounds = sceneSounds(plan).map((s) => s.entry.source);
  const curatedIds = new Set(sounds.flatMap((s) => (s.kind === "curated" ? [s.id] : [])));

  const [elements, curated] = await Promise.all([
    Promise.all([...elementIds].map(async (id) => elementRecordSchema.parse(await fetchJson(new URL(`library/elements/${id}.json`, root))))),
    Promise.all([...curatedIds].map(async (id) => ambientLoopRecordSchema.parse(await fetchJson(new URL(`library/ambient/${id}.json`, root))))),
  ]);

  const services = new Set<string>();
  for (const element of elements) {
    if (element.service !== LOCAL_FINISH) services.add(element.service);
    if (element.kind === "prop" && element.animation) services.add(element.animation.service);
  }
  services.add(plan.soundtrack.music.service);
  for (const source of sounds) if (source.kind === "generated") services.add(source.service);

  return {
    services: [...services].map(serviceName),
    attributions: curated.map(({ attribution, licence, licenceUrl, sourceUrl }) => ({ attribution, licence, licenceUrl, sourceUrl })),
  };
}

export function aiNotice(services: string[]): string {
  if (services.length === 0) return AI_NOTICE;
  const named = services.length === 1 ? services[0] : `${services.slice(0, -1).join(", ")} and ${services.at(-1)}`;
  return `Artwork, music and sound effects generated with AI using ${named}.`;
}
