import { GoogleGenAI } from "@google/genai";
import { HttpError } from "./http.ts";
import { service } from "./services.ts";

const POLL_LIMIT_MS = 10 * 60 * 1000;

export async function stableAudio(prompt: string, seconds: number, seed: number): Promise<Uint8Array> {
  const { baseUrl, key } = service("stability");
  const form = new FormData();
  form.set("prompt", prompt);
  form.set("duration", String(seconds));
  form.set("output_format", "wav");
  form.set("seed", String(seed));
  const submit = await fetch(`${baseUrl}/v2beta/audio/stable-audio/text-to-audio`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    body: form,
  });
  if (!submit.ok) throw new HttpError(`stable audio submit (${await submit.text()})`, submit.status);
  const { id } = (await submit.json()) as { id: string };

  const pollMs = Number(process.env.STABILITY_POLL_MS ?? 5000);
  const deadline = Date.now() + POLL_LIMIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const poll = await fetch(`${baseUrl}/v2beta/audio/results/${id}`, { headers: { Authorization: `Bearer ${key}`, Accept: "audio/*" } });
    if (poll.status === 202) {
      await poll.body?.cancel();
      continue;
    }
    if (!poll.ok) throw new HttpError(`stable audio result ${id} (${await poll.text()})`, poll.status);
    return new Uint8Array(await poll.arrayBuffer());
  }
  throw new Error(`stable audio result ${id} not ready after ${POLL_LIMIT_MS / 60000} minutes`);
}

export async function lyria(prompt: string): Promise<Uint8Array> {
  const { baseUrl, key } = service("gemini");
  const version = baseUrl.match(/\/(v1\w*)$/)?.[1] ?? "v1beta";
  const ai = new GoogleGenAI({ apiKey: key, httpOptions: { baseUrl: baseUrl.replace(/\/v1\w*$/, ""), apiVersion: version } });
  const res = await ai.interactions.create({
    model: "lyria-3.5",
    input: `${prompt} Make it about 2 minutes and 15 seconds long.`,
    response_format: { type: "audio", mime_type: "audio/wav" },
  });
  const audio = res.output_audio;
  if (!audio?.data) throw new Error("lyria returned no audio");
  return Buffer.from(audio.data, "base64");
}
