import type { ServiceFixture } from "../../fixture-server.ts";
import { wavBytes } from "../../../pipeline/lib/audio.ts";
import { synthMusic } from "./synth-music.ts";

export const GEMINI_KEY = "fixture-gemini-key";

let wav: string | undefined;
const cannedWav = () => (wav ??= wavBytes(synthMusic(133, 48000)).toString("base64"));

export const gemini: ServiceFixture = {
  name: "gemini",
  env: (base) => ({ GEMINI_BASE_URL: `${base}/v1beta`, GEMINI_API_KEY: GEMINI_KEY }),
  handle(req) {
    const key = req.query.get("key") ?? req.headers["x-goog-api-key"];
    if (key !== GEMINI_KEY) return { status: 400, json: { error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT" } } };
    if (req.method === "GET" && req.path === "/v1beta/models") {
      return { json: { models: [{ name: "models/gemini-2.5-flash" }, { name: "models/lyria-3.5" }] } };
    }
    if (req.method === "POST" && req.path === "/v1beta/interactions") {
      const { model } = JSON.parse(req.body.toString());
      if (model !== "lyria-3.5") return { status: 404, json: { error: { code: 404, message: `model ${model} not found`, status: "NOT_FOUND" } } };
      return {
        json: {
          id: "fixture-lyria-1", model, status: "completed",
          steps: [{ type: "model_output", content: [{ type: "audio", data: cannedWav(), mime_type: "audio/wav", sample_rate: 48000, channels: 2 }] }],
        },
      };
    }
    return undefined;
  },
};
