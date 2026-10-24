import { appendFileSync } from "node:fs";
import { takeSlot } from "../../pipeline/lib/job-slots.ts";

const [dir, log, rounds] = process.argv.slice(2);
for (let i = 0; i < Number(rounds); i++) {
  const slot = await takeSlot(dir, 8, 1);
  appendFileSync(log, "+");
  await new Promise((r) => setImmediate(r));
  appendFileSync(log, "-");
  slot.release();
}
