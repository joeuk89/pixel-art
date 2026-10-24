import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServiceFixture } from "../../fixture-server.ts";

export const FAL_KEY = "fixture-fal-key";
export const SOUND_EFFECTS = "/fal-ai/elevenlabs/sound-effects/v2";
export const FAILING_BRIEF = "a sound the model cannot make";

const audio = join(import.meta.dirname, "freesound");
const submitted = new Map<string, { text: string; loop?: boolean }>();
let next = 1;

export const fal: ServiceFixture = {
  name: "fal",
  env: (base) => ({ FAL_BASE_URL: base, FAL_KEY }),
  handle(req, base) {
    const media = req.path.match(/^\/media\/([a-z]+\.ogg)$/);
    if (req.method === "GET" && media) return { body: readFileSync(join(audio, media[1])), type: "audio/ogg" };
    if (req.headers.authorization !== `Key ${FAL_KEY}`) return { status: 401, json: { detail: "No user found for Key ID and Secret" } };
    if (req.method === "POST" && req.path === SOUND_EFFECTS) {
      const input = JSON.parse(req.body.toString("utf8"));
      const id = `fixture-request-${next++}`;
      submitted.set(id, input);
      const at = `${base}/fal-ai/elevenlabs/requests/${id}`;
      return { json: { request_id: id, status_url: `${at}/status`, response_url: at, cancel_url: `${at}/cancel`, queue_position: 0 } };
    }
    const status = req.path.match(/^\/fal-ai\/elevenlabs\/requests\/([^/]+)\/status$/);
    if (req.method === "GET" && status) {
      if (!submitted.has(status[1])) return { status: 404, json: { detail: "Request not found" } };
      return { json: { status: "COMPLETED", request_id: status[1], response_url: `${base}/fal-ai/elevenlabs/requests/${status[1]}` } };
    }
    const result = req.path.match(/^\/fal-ai\/elevenlabs\/requests\/([^/]+)$/);
    if (req.method === "GET" && result) {
      const input = submitted.get(result[1]);
      if (!input) return { status: 404, json: { detail: "Request not found" } };
      if (input.text === FAILING_BRIEF) return { status: 500, json: { detail: "inference_failed" } };
      const file = input.loop ? "bed.ogg" : "burst.ogg";
      return { json: { audio: { url: `${base}/media/${file}`, content_type: "audio/ogg", file_name: file } } };
    }
    return undefined;
  },
};
