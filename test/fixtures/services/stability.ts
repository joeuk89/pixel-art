import type { ServiceFixture } from "../../fixture-server.ts";

export const STABILITY_KEY = "fixture-stability-key";

export const stability: ServiceFixture = {
  name: "stability",
  env: (base) => ({ STABILITY_BASE_URL: base, STABILITY_API_KEY: STABILITY_KEY }),
  handle(req) {
    if (req.headers.authorization !== `Bearer ${STABILITY_KEY}`) {
      return { status: 401, json: { id: "fixture", name: "unauthorized", errors: ["missing authorization header"] } };
    }
    if (req.method === "GET" && req.path === "/v1/user/balance") return { json: { credits: 12.5 } };
    return undefined;
  },
};
