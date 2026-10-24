import type { ServiceFixture } from "../../fixture-server.ts";

export const GEMINI_KEY = "fixture-gemini-key";

export const gemini: ServiceFixture = {
  name: "gemini",
  env: (base) => ({ GEMINI_BASE_URL: `${base}/v1beta`, GEMINI_API_KEY: GEMINI_KEY }),
  handle(req) {
    if (req.query.get("key") !== GEMINI_KEY) return { status: 400, json: { error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT" } } };
    if (req.method === "GET" && req.path === "/v1beta/models") {
      return { json: { models: [{ name: "models/gemini-2.5-flash" }, { name: "models/lyria-3.5" }] } };
    }
    return undefined;
  },
};
