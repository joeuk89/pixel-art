import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export type Slot = { release: () => void };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

const unique = () => `${process.pid}.${randomBytes(6).toString("hex")}`;

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function ownerIsDead(token: string): boolean {
  const pid = Number(token.split(" ")[0]);
  return Number.isInteger(pid) && pid > 0 && !alive(pid);
}

function tryLink(from: string, to: string): boolean {
  try {
    linkSync(from, to);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

// Moving the file aside first lets a reclaimer check what it took: a fresh lock moved by mistake is linked back.
function reclaim(path: string, deadToken: string): void {
  const grave = `${path}.stale.${unique()}`;
  try {
    renameSync(path, grave);
  } catch {
    return;
  }
  if (read(grave) !== deadToken) tryLink(grave, path);
  try { unlinkSync(grave); } catch { /* already gone */ }
}

// The pid is written to a private file and hard-linked into place, so a slot file is never visible without its owner.
function tryTake(path: string, token: string): boolean {
  const temp = `${path}.new.${unique()}`;
  writeFileSync(temp, token);
  try {
    for (let tries = 0; tries < 3; tries++) {
      if (tryLink(temp, path)) return true;
      const held = read(path);
      if (held === null) continue;
      if (!ownerIsDead(held)) return false;
      reclaim(path, held);
    }
    return false;
  } finally {
    unlinkSync(temp);
  }
}

// One lock file per slot, so the cap holds across separate processes.
export async function takeSlot(dir: string, slots: number, waitMs: number): Promise<Slot> {
  mkdirSync(dir, { recursive: true });
  const token = `${process.pid} ${randomBytes(6).toString("hex")}`;
  for (;;) {
    for (let k = 0; k < slots; k++) {
      const path = join(dir, `slot-${k}.lock`);
      if (tryTake(path, token)) {
        return {
          release: () => {
            if (read(path) === token) unlinkSync(path);
          },
        };
      }
    }
    await sleep(waitMs * (0.5 + Math.random()));
  }
}
