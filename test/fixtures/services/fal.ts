import type { ServiceFixture } from "../../fixture-server.ts";

export const FAL_KEY = "fixture-fal-key";

export const fal: ServiceFixture = {
  name: "fal",
  env: (base) => ({ FAL_BASE_URL: base, FAL_KEY }),
  handle(req) {
    if (req.headers.authorization !== `Key ${FAL_KEY}`) return { status: 401, json: { detail: "No user found for Key ID and Secret" } };
    if (req.method === "GET" && /^\/fal-ai\/[^/]+\/requests\/[^/]+\/status$/.test(req.path)) {
      return { status: 404, json: { detail: "Request not found" } };
    }
    return undefined;
  },
};
