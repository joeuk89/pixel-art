import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type SceneStatus = { id: string; file: string; status: string };
export type ValidationReport = {
  ok: boolean;
  errors: { file: string; path: string; message: string }[];
  scenes: SceneStatus[];
};

const validateScript = join(dirname(fileURLToPath(import.meta.url)), "..", "validate.ts");

export function validationReport(root: string): ValidationReport {
  const run = spawnSync(process.execPath, [validateScript], { cwd: root, encoding: "utf8" });
  try {
    return JSON.parse(run.stdout);
  } catch {
    throw new Error(`validate did not report: ${run.stderr}`);
  }
}
