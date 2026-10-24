import { main } from "./lib/cli.ts";
import { hardChecks } from "./lib/hard-checks.ts";
import { readScene } from "./lib/library.ts";

main(async () => {
  const [file, ...rest] = process.argv.slice(2);
  if (!file || rest.length > 0) throw new Error("usage: check-scene <scene.json>");
  const plan = readScene(file);
  const report = await hardChecks(process.cwd(), file, plan);
  for (const c of report.checks) for (const p of c.problems) process.stderr.write(`${c.name}: ${p}\n`);
  return { ok: report.ok, scene: plan.id, checks: report.checks };
});
