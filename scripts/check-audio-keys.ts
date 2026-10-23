// Run with: node scripts/check-audio-keys.ts
// Confirms each audio-service key in .env is accepted. Makes no paid calls.
process.loadEnvFile(".env");

type Check = { name: string; env: string; run: (key: string) => Promise<string> };

const checks: Check[] = [
  {
    name: "Stability AI (Stable Audio 3.0)",
    env: "STABILITY_API_KEY",
    async run(key) {
      const r = await fetch("https://api.stability.ai/v1/user/balance", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { credits } = (await r.json()) as { credits: number };
      return `ok, balance ${credits} credits`;
    },
  },
  {
    name: "Google Gemini API (Lyria 3.5)",
    env: "GEMINI_API_KEY",
    async run(key) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${key}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { models = [] } = (await r.json()) as { models?: { name: string }[] };
      const lyria = models.filter((m) => m.name.includes("lyria")).map((m) => m.name.replace("models/", ""));
      return lyria.length ? `ok, Lyria models: ${lyria.join(", ")}` : "ok, but no Lyria model listed (billing enabled?)";
    },
  },
  {
    name: "fal.ai (ElevenLabs Sound Effects v2)",
    env: "FAL_KEY",
    async run(key) {
      const url =
        "https://queue.fal.run/fal-ai/elevenlabs/requests/00000000-0000-0000-0000-000000000000/status";
      const r = await fetch(url, { headers: { Authorization: `Key ${key}` } });
      if (r.status === 401 || r.status === 403) throw new Error(`HTTP ${r.status}, key rejected`);
      return `ok, key accepted (probe returned HTTP ${r.status}, expected for an unknown request id)`;
    },
  },
  {
    name: "Freesound API",
    env: "FREESOUND_API_KEY",
    async run(key) {
      const r = await fetch(`https://freesound.org/apiv2/search/text/?query=rain&page_size=1&token=${key}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { count } = (await r.json()) as { count: number };
      return `ok, ${count} results for "rain"`;
    },
  },
];

async function main() {
  let failed = false;
  for (const c of checks) {
    const key = process.env[c.env];
    if (!key) {
      console.log(`SKIP  ${c.name}: ${c.env} is empty`);
      failed = true;
      continue;
    }
    try {
      console.log(`PASS  ${c.name}: ${await c.run(key)}`);
    } catch (e) {
      console.log(`FAIL  ${c.name}: ${(e as Error).message}`);
      failed = true;
    }
  }
  process.exitCode = failed ? 1 : 0;
}

main();
