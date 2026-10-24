import { openSync, readSync, closeSync } from "node:fs";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngSize(path: string): { width: number; height: number } {
  const head = Buffer.alloc(24);
  const fd = openSync(path, "r");
  try {
    readSync(fd, head, 0, 24, 0);
  } finally {
    closeSync(fd);
  }
  if (!head.subarray(0, 8).equals(SIGNATURE) || head.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`${path} is not a PNG`);
  }
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}
