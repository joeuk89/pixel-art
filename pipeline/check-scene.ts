import { hardChecks } from "./lib/hard-checks.ts";
import { readScene } from "./lib/library.ts";

const [file, ...rest] = process.argv.slice(2);
try {
  if (!file || rest.length > 0) throw new Error("usage: check-scene <scene.json>");
  const plan = readScene(file);
  const report = await hardChecks(process.cwd(), file, plan);
  for (const c of report.checks) for (const p of c.problems) process.stderr.write(`${c.name}: ${p}\n`);
  process.stdout.write(JSON.stringify({ ok: report.ok, scene: plan.id, checks: report.checks }, null, 2) + "\n");
  process.exitCode = report.ok ? 0 : 1;
} catch (e) {
  process.stderr.write((e as Error).message + "\n");
  process.stdout.write(JSON.stringify({ ok: false, error: (e as Error).message }, null, 2) + "\n");
  process.exitCode = 1;
}
