import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

export type Slot = { release: () => void };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function tryTake(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    let owner = NaN;
    try {
      owner = Number(readFileSync(path, "utf8"));
    } catch {
      return false;
    }
    if (alive(owner)) return false;
    try {
      unlinkSync(path);
    } catch {
      return false;
    }
    return tryTake(path);
  }
  writeSync(fd, String(process.pid));
  closeSync(fd);
  return true;
}

// One lock file per slot, taken with an exclusive create, so the cap holds across separate processes.
export async function takeSlot(dir: string, slots: number, waitMs: number): Promise<Slot> {
  mkdirSync(dir, { recursive: true });
  for (;;) {
    for (let k = 0; k < slots; k++) {
      const path = join(dir, `slot-${k}.lock`);
      if (tryTake(path)) {
        return {
          release: () => {
            try { unlinkSync(path); } catch { /* already reclaimed */ }
          },
        };
      }
    }
    await sleep(waitMs * (0.5 + Math.random()));
  }
}
