import { cpSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
export const fixtures = join(repo, "test/fixtures");
export const fixtureScene = "scenes/fixture-rainy-desk-a1b2/scene.json";

export function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), "pixel-art-"));
  cpSync(join(fixtures, "library"), join(root, "library"), { recursive: true });
  cpSync(join(fixtures, "scenes"), join(root, "scenes"), { recursive: true });
  cpSync(join(repo, "library/palettes"), join(root, "library/palettes"), { recursive: true });
  const ambient = join(root, "library/ambient");
  mkdirSync(ambient, { recursive: true });
  for (const name of readdirSync(join(repo, "library/ambient"))) {
    const from = join(repo, "library/ambient", name);
    if (name.endsWith(".json")) cpSync(from, join(ambient, name));
    else symlinkSync(from, join(ambient, name));
  }
  return root;
}

export function readJson(root: string, path: string): any {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

export function writeJson(root: string, path: string, value: unknown): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), JSON.stringify(value, null, 2));
}

export function editJson(root: string, path: string, edit: (value: any) => void): void {
  const value = readJson(root, path);
  edit(value);
  writeJson(root, path, value);
}

export type ValidateResult = { code: number | null; report: any; stderr: string };

export function validate(root: string, ...args: string[]): ValidateResult {
  const run = spawnSync(process.execPath, [join(repo, "pipeline/validate.ts"), ...args], { cwd: root, encoding: "utf8" });
  return { code: run.status, report: JSON.parse(run.stdout), stderr: run.stderr };
}

export type ScriptResult = { code: number | null; out: any; stderr: string };

export function runScript(root: string, script: string, ...args: string[]): ScriptResult {
  const run = spawnSync(process.execPath, [join(repo, "pipeline", `${script}.ts`), ...args], { cwd: root, encoding: "utf8" });
  return { code: run.status, out: JSON.parse(run.stdout), stderr: run.stderr };
}
