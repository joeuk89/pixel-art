import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAbandoned, type Abandoned } from "./lib/attempts.ts";
import { hardChecks } from "./lib/hard-checks.ts";
import { readElements, readScene } from "./lib/library.ts";
import { editPlan } from "./lib/plan-file.ts";
import { DEV_URL } from "./lib/site.ts";
import type { ScenePlan } from "../schema/index.ts";

const root = process.cwd();
const ledgerScript = join(dirname(fileURLToPath(import.meta.url)), "ledger.ts");
const round = (n: number) => Math.round(n * 1e4) / 1e4;

function git(...args: string[]): string {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr.trim()}`);
  return run.stdout;
}

function ledger(plan: ScenePlan) {
  const run = spawnSync(process.execPath, [ledgerScript], { cwd: root, encoding: "utf8" });
  const month = JSON.parse(run.stdout);
  if (!month.ok) throw new Error(`ledger failed: ${month.error}`);
  const sceneUsd = Object.values(plan.cost.meteredUsd).reduce((sum, usd) => sum + usd, 0);
  const { ok, ...rest } = month;
  return { ...rest, afterCommit: { pixellabGenerations: month.pixellabGenerations.used + plan.cost.pixellabGenerations, meteredUsd: round(month.metered.usd + sceneUsd) } };
}

async function listening(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}

function elementsOf(plan: ScenePlan) {
  const records = new Map(readElements(root).map((e) => [e.id, e]));
  const placed = [...new Set(plan.layers.flatMap((l) => (l.placements ?? []).map((p) => p.element)))];
  return {
    generated: placed.filter((id) => records.get(id)?.firstScene === plan.id),
    reused: placed.filter((id) => records.get(id)?.firstScene !== plan.id),
  };
}

function describe(a: Abandoned): string {
  if (a.outcome === "substituted") return `Substituted: ${a.substitute} for ${a.element} (${a.placement})`;
  if (a.outcome === "dropped") return `Dropped: ${a.placement} (${a.element})`;
  return `Still only, no Frame strip: ${a.element} (${a.placement})`;
}

function commitMessage(plan: ScenePlan, elements: ReturnType<typeof elementsOf>, abandoned: Abandoned[]): string {
  const usd = round(Object.values(plan.cost.meteredUsd).reduce((sum, n) => sum + n, 0));
  const lines = [
    `Scene id: ${plan.id}`,
    ...(elements.generated.length ? [`Generated: ${elements.generated.join(", ")}`] : []),
    ...(elements.reused.length ? [`Reused: ${elements.reused.join(", ")}`] : []),
    ...abandoned.map(describe),
    `Cost: ${plan.cost.pixellabGenerations} PixelLab generations, $${usd} metered`,
  ];
  return `Add the Scene "${plan.title}"\n\nPrompt: ${plan.prompt}\n\n${lines.join("\n")}\n`;
}

async function preview(file: string) {
  const planPath = resolve(root, file);
  const plan = readScene(planPath);
  const report = await hardChecks(root, file, plan);
  if (!report.ok) {
    if (plan.status !== "draft") editPlan(planPath, (raw) => { raw.status = "draft"; });
    return { ok: false, scene: plan.id, error: "a hard check failed; nothing is staged and the Scene is draft", checks: report.checks };
  }

  if (plan.status !== "resolved") editPlan(planPath, (raw) => { raw.status = "resolved"; });
  git("add", "--", relative(root, dirname(planPath)), "library", "gallery.json");
  const staged = git("diff", "--cached", "--name-only").split("\n").filter(Boolean).sort();

  const elements = elementsOf(plan);
  const abandoned = readAbandoned(plan.id);
  return {
    ok: true,
    scene: plan.id,
    previewUrl: `${DEV_URL}scenes/${plan.id}/`,
    devServer: { url: DEV_URL, listening: await listening(DEV_URL) },
    staged,
    cost: plan.cost,
    ledger: ledger(plan),
    elements,
    abandoned,
    commitMessage: commitMessage(plan, elements, abandoned),
    checks: report.checks,
  };
}

const [file, ...rest] = process.argv.slice(2);
try {
  if (!file || rest.length > 0) throw new Error("usage: preview <scene.json>");
  const out = await preview(file);
  if (!out.ok) for (const c of out.checks.filter((c) => !c.ok)) for (const p of c.problems) process.stderr.write(`${c.name}: ${p}\n`);
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  process.exitCode = out.ok ? 0 : 1;
} catch (e) {
  process.stderr.write((e as Error).message + "\n");
  process.stdout.write(JSON.stringify({ ok: false, error: (e as Error).message }, null, 2) + "\n");
  process.exitCode = 1;
}
