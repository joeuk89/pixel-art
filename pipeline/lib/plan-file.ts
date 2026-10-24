import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { scenePlanSchema } from "../../schema/index.ts";

const WAIT_MS = 20;
const GIVE_UP_MS = 60_000;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function lock(path: string): () => void {
  const lockFile = `${path}.lock`;
  const started = Date.now();
  for (;;) {
    try {
      writeFileSync(lockFile, String(process.pid), { flag: "wx" });
      return () => unlinkSync(lockFile);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    let owner = NaN;
    try { owner = Number(readFileSync(lockFile, "utf8")); } catch {}
    if (Number.isInteger(owner) && owner > 0 && !alive(owner)) {
      try { unlinkSync(lockFile); } catch {}
      continue;
    }
    if (Date.now() - started > GIVE_UP_MS) throw new Error(`${lockFile} has been held for over ${GIVE_UP_MS / 1000} s`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, WAIT_MS);
  }
}

// Scripts run in parallel during generation, so every shared JSON edit re-reads the file under a lock and replaces it atomically.
export function editJsonLocked<T>(path: string, fallback: unknown, edit: (raw: any) => T): T {
  const release = lock(path);
  try {
    const raw = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
    const result = edit(raw);
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(raw, null, 2) + "\n");
    renameSync(temp, path);
    return result;
  } finally {
    release();
  }
}

export function editPlan<T>(path: string, edit: (raw: any) => T): T {
  return editJsonLocked(path, undefined, (raw) => {
    const result = edit(raw);
    scenePlanSchema.parse(raw);
    return result;
  });
}
