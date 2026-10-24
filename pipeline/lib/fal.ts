import { getBytes, getJson } from "./http.ts";
import { service } from "./services.ts";

export const SOUND_EFFECTS_MODEL = "fal-ai/elevenlabs/sound-effects/v2";
export const USD_PER_SECOND = 0.002;
export const MAX_LOOP_SEC = 22;
// Opus is gapless; MP3 encoder padding would break a loop's seam.
const OUTPUT_FORMAT = "opus_48000_128";
const POLL_MS = 1000;
const TIMEOUT_MS = 5 * 60 * 1000;

export type SoundEffectRequest = { text: string; loop: boolean };
export type SoundEffect = { requestId: string; audioUrl: string; bytes: Uint8Array; params: Record<string, unknown> };

type Queued = { request_id: string; status_url: string; response_url: string };
type Status = { status: string; error?: string };

export async function generateSoundEffect({ text, loop }: SoundEffectRequest): Promise<SoundEffect> {
  const { baseUrl, key } = service("fal");
  const headers = { Authorization: `Key ${key}` };
  const params = { loop, ...(loop ? { duration_seconds: MAX_LOOP_SEC } : {}), output_format: OUTPUT_FORMAT };
  const queued = await getJson<Queued>("fal submit", `${baseUrl}/${SOUND_EFFECTS_MODEL}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...params }),
  });
  const what = `fal request ${queued.request_id}`;
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const { status, error } = await getJson<Status>(`${what} status`, queued.status_url, { headers });
    if (status === "COMPLETED") {
      if (error) throw new Error(`${what}: ${error}`);
      break;
    }
    if (Date.now() > deadline) throw new Error(`${what}: still ${status} after ${TIMEOUT_MS / 1000} s`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  const { audio } = await getJson<{ audio: { url: string } }>(`${what} result`, queued.response_url, { headers });
  return { requestId: queued.request_id, audioUrl: audio.url, bytes: await getBytes(`${what} audio`, audio.url), params };
}
