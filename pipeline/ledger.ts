import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { USD_PER_GBP } from "./lib/budget.ts";
import { main } from "./lib/cli.ts";
import { readScene, sceneFiles } from "./lib/library.ts";

const PIXELLAB_GENERATIONS_CEILING = 2000;
const METERED_CEILING_GBP = 50;

const roundUsd = (n: number) => Math.round(n * 1e4) / 1e4;

function committedFiles(): Set<string> {
  const run = spawnSync("git", ["ls-tree", "-r", "--name-only", "HEAD", "--", "scenes"], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git cannot list committed Scenes: ${run.stderr.trim()}`);
  return new Set(run.stdout.split("\n").filter(Boolean));
}

main(() => {
  const { values, positionals } = parseArgs({ options: { month: { type: "string" } }, allowPositionals: true });
  if (positionals.length > 0) throw new Error("usage: ledger [--month YYYY-MM]");
  const month = values.month ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("--month must be YYYY-MM");

  const committed = committedFiles();
  const scenes = sceneFiles()
    .filter((file) => committed.has(file))
    .map(readScene)
    .filter((plan) => plan.createdAt.startsWith(month))
    .map((plan) => ({ id: plan.id, createdAt: plan.createdAt, pixellabGenerations: plan.cost.pixellabGenerations, meteredUsd: plan.cost.meteredUsd }));

  const used = scenes.reduce((sum, s) => sum + s.pixellabGenerations, 0);
  const byService: Record<string, number> = {};
  for (const s of scenes) {
    for (const [service, usd] of Object.entries(s.meteredUsd)) byService[service] = roundUsd((byService[service] ?? 0) + usd);
  }
  const usd = roundUsd(Object.values(byService).reduce((sum, n) => sum + n, 0));
  const ceilingUsd = roundUsd(METERED_CEILING_GBP * USD_PER_GBP);

  return {
    month,
    scenes,
    pixellabGenerations: { used, ceiling: PIXELLAB_GENERATIONS_CEILING, remaining: PIXELLAB_GENERATIONS_CEILING - used },
    metered: { usd, byService, ceilingGbp: METERED_CEILING_GBP, usdPerGbp: USD_PER_GBP, ceilingUsd, remainingUsd: roundUsd(ceilingUsd - usd) },
    overCeiling: used > PIXELLAB_GENERATIONS_CEILING || usd > ceilingUsd,
  };
});
