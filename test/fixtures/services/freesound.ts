import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServiceFixture } from "../../fixture-server.ts";

const CC0 = "http://creativecommons.org/publicdomain/zero/1.0/";
const CC_BY = "https://creativecommons.org/licenses/by/4.0/";
const audio = join(import.meta.dirname, "freesound");

type Sound = { name: string; username: string; duration: number; license: string; type: string; samplerate: number; channels: number; tags: string[]; preview: string };

export const FREESOUND_KEY = "fixture-freesound-key";

export const sounds: Record<number, Sound> = {
  641306: { name: "House Room Tone", username: "aleclubin", duration: 14, license: CC0, type: "wav", samplerate: 44100, channels: 2, tags: ["room-tone"], preview: "bed.ogg" },
  753540: { name: "House Vent Loop 01", username: "ventman", duration: 14, license: CC0, type: "wav", samplerate: 44100, channels: 2, tags: ["vent"], preview: "bed.ogg" },
  195522: { name: "Distant Thunder", username: "stormwatch", duration: 4, license: CC0, type: "wav", samplerate: 44100, channels: 1, tags: ["thunder"], preview: "burst.ogg" },
  100001: { name: "Attribution Rain", username: "byauthor", duration: 14, license: CC_BY, type: "wav", samplerate: 44100, channels: 2, tags: ["rain"], preview: "bed.ogg" },
};

export const freesound: ServiceFixture = {
  name: "freesound",
  env: (base) => ({ FREESOUND_BASE_URL: `${base}/apiv2`, FREESOUND_API_KEY: FREESOUND_KEY }),
  handle(req, base) {
    if (req.query.get("token") !== FREESOUND_KEY && req.path.startsWith("/apiv2/")) {
      return { status: 401, json: { detail: "Authentication credentials were not provided." } };
    }
    const sound = req.path.match(/^\/apiv2\/sounds\/(\d+)\/$/);
    if (sound) {
      const id = Number(sound[1]);
      const s = sounds[id];
      if (!s) return { status: 404, json: { detail: "Not found." } };
      const preview = `${base}/previews/${id}/${s.preview}`;
      return {
        json: {
          id, name: s.name, username: s.username, duration: s.duration, license: s.license, tags: s.tags,
          description: `${s.name} (fixture)`, type: s.type, samplerate: s.samplerate, channels: s.channels,
          url: `https://freesound.org/people/${s.username}/sounds/${id}/`,
          previews: {
            "preview-hq-mp3": preview.replace(".ogg", ".mp3"), "preview-lq-mp3": preview.replace(".ogg", ".mp3"),
            "preview-hq-ogg": preview, "preview-lq-ogg": preview,
          },
        },
      };
    }
    const file = req.path.match(/^\/previews\/\d+\/([a-z]+\.ogg)$/);
    if (file) return { body: readFileSync(join(audio, file[1])), type: "audio/ogg" };
    if (req.path === "/apiv2/search/text/") {
      return { json: { count: 2, next: null, previous: null, results: [{ id: 641306, name: "House Room Tone", tags: [], license: CC0, username: "aleclubin" }] } };
    }
    return undefined;
  },
};
