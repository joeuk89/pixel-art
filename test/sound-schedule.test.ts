import { test } from "node:test";
import assert from "node:assert/strict";
import { loopOffset, oneshotFires, type Fire } from "../viewer/sound-schedule.ts";

function take(fires: Iterator<Fire>, n: number): Fire[] {
  return Array.from({ length: n }, () => fires.next().value as Fire);
}

const every: [number, number] = [90, 240];

test("the same seed gives the same One-shot firing times and jitter", () => {
  assert.deepEqual(take(oneshotFires(1337, 0, every), 50), take(oneshotFires(1337, 0, every), 50));
});

test("a different seed or a different One-shot gives a different schedule", () => {
  const base = take(oneshotFires(1337, 0, every), 10);
  assert.notDeepEqual(take(oneshotFires(1338, 0, every), 10), base);
  assert.notDeepEqual(take(oneshotFires(1337, 1, every), 10), base);
});

test("the first fire waits a full interval and later fires are spaced within every", () => {
  for (const seed of [1, 2, 3, 1337, 99999]) {
    const fires = take(oneshotFires(seed, 0, every), 200);
    let previous = 0;
    for (const { at } of fires) {
      const gap = at - previous;
      assert.ok(gap >= 90 && gap <= 240, `gap ${gap}`);
      previous = at;
    }
    assert.ok(fires[0].at >= 90);
  }
});

test("intervals spread across the whole every range rather than sitting at one value", () => {
  const fires = take(oneshotFires(7, 0, [10, 20]), 500);
  const gaps = fires.map((f, k) => f.at - (k ? fires[k - 1].at : 0));
  assert.ok(Math.min(...gaps) < 11 && Math.max(...gaps) > 19, `gaps from ${Math.min(...gaps)} to ${Math.max(...gaps)}`);
});

test("a fixed every fires at exact multiples", () => {
  assert.deepEqual(take(oneshotFires(5, 0, [30, 30]), 3).map((f) => f.at), [30, 60, 90]);
});

test("each fire's gain is jittered within plus or minus 2 dB and its rate within plus or minus 3 percent", () => {
  const fires = take(oneshotFires(42, 0, every), 1000);
  const db = fires.map((f) => 20 * Math.log10(f.gain));
  const rates = fires.map((f) => f.rate);
  assert.ok(Math.min(...db) >= -2 && Math.max(...db) <= 2);
  assert.ok(Math.min(...db) < -1.8 && Math.max(...db) > 1.8, "gain jitter does not use its range");
  assert.ok(Math.min(...rates) >= 0.97 && Math.max(...rates) <= 1.03);
  assert.ok(Math.min(...rates) < 0.975 && Math.max(...rates) > 1.025, "rate jitter does not use its range");
});

test("an Ambient loop's start offset is seeded, inside the loop and differs between loops", () => {
  assert.equal(loopOffset(1337, 0, 12), loopOffset(1337, 0, 12));
  assert.notEqual(loopOffset(1337, 0, 12), loopOffset(1337, 1, 12));
  for (let k = 0; k < 200; k++) {
    const offset = loopOffset(k, k % 5, 3);
    assert.ok(offset >= 0 && offset < 3, `offset ${offset}`);
  }
});
