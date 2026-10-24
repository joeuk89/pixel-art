import type { ServiceFixture } from "../../fixture-server.ts";
import { wavBytes } from "../../../pipeline/lib/audio.ts";
import { synthMusic } from "./synth-music.ts";

export const STABILITY_KEY = "fixture-stability-key";

let wav: Buffer | undefined;
const cannedWav = () => (wav ??= wavBytes(synthMusic(135, 44100)));

let submitted = 0;
const polls = new Map<string, number>();

export const stability: ServiceFixture = {
  name: "stability",
  env: (base) => ({ STABILITY_BASE_URL: base, STABILITY_API_KEY: STABILITY_KEY }),
  handle(req) {
    if (req.headers.authorization !== `Bearer ${STABILITY_KEY}`) {
      return { status: 401, json: { id: "fixture", name: "unauthorized", errors: ["missing authorization header"] } };
    }
    if (req.method === "GET" && req.path === "/v1/user/balance") return { json: { credits: 12.5 } };
    if (req.method === "POST" && req.path === "/v2beta/audio/stable-audio/text-to-audio") {
      if (req.headers.accept !== "application/json") return { status: 400, json: { name: "bad_request", errors: ["accept must be application/json"] } };
      const id = `fixture-music-${++submitted}`;
      polls.set(id, 0);
      return { json: { id } };
    }
    const result = req.path.match(/^\/v2beta\/audio\/results\/([\w-]+)$/);
    if (req.method === "GET" && result) {
      const id = result[1], seen = polls.get(id);
      if (seen === undefined) return { status: 404, json: { name: "not_found", errors: [`no generation ${id}`] } };
      if (req.headers.accept !== "audio/*") return { status: 400, json: { name: "bad_request", errors: ["accept must be audio/*"] } };
      polls.set(id, seen + 1);
      if (seen === 0) return { status: 202, json: { id, status: "in-progress" } };
      return { body: cannedWav(), type: "audio/wav" };
    }
    return undefined;
  },
};
