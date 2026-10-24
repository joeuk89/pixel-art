import { searchCount } from "./lib/freesound.ts";
import { getJson } from "./lib/http.ts";
import { MissingEnvError, service, type ServiceName } from "./lib/services.ts";

type Check = { service: ServiceName; run: () => Promise<string> };
type Result = { service: ServiceName; status: "pass" | "fail" | "skip"; detail: string };

const UNKNOWN_REQUEST = "00000000-0000-0000-0000-000000000000";

const checks: Check[] = [
  {
    service: "stability",
    async run() {
      const { baseUrl, key } = service("stability");
      const { credits } = await getJson<{ credits: number }>("stability balance", `${baseUrl}/v1/user/balance`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      return `balance ${credits} credits`;
    },
  },
  {
    service: "gemini",
    async run() {
      const { baseUrl, key } = service("gemini");
      const { models = [] } = await getJson<{ models?: { name: string }[] }>("gemini models", `${baseUrl}/models?pageSize=1000&key=${encodeURIComponent(key)}`);
      const lyria = models.filter((m) => m.name.includes("lyria")).map((m) => m.name.replace("models/", ""));
      return lyria.length ? `Lyria models: ${lyria.join(", ")}` : "no Lyria model listed (billing enabled?)";
    },
  },
  {
    service: "fal",
    async run() {
      const { baseUrl, key } = service("fal");
      const res = await fetch(`${baseUrl}/fal-ai/elevenlabs/requests/${UNKNOWN_REQUEST}/status`, { headers: { Authorization: `Key ${key}` } });
      if (res.status === 401 || res.status === 403) throw new Error(`fal status: HTTP ${res.status}, key rejected`);
      return `key accepted (probe returned HTTP ${res.status}, expected for an unknown request id)`;
    },
  },
  {
    service: "freesound",
    async run() {
      return `${await searchCount("rain")} results for "rain"`;
    },
  },
];

const results: Result[] = [];
for (const check of checks) {
  try {
    results.push({ service: check.service, status: "pass", detail: await check.run() });
  } catch (e) {
    results.push({ service: check.service, status: e instanceof MissingEnvError ? "skip" : "fail", detail: (e as Error).message });
  }
}
const ok = results.every((r) => r.status === "pass");
process.stdout.write(JSON.stringify({ ok, checks: results }, null, 2) + "\n");
process.exitCode = ok ? 0 : 1;
