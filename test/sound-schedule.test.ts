import { test } from "node:test";
import assert from "node:assert/strict";
import { CROSSFADE_SEC, crossfade, loopOffset, oneshotFires, variantSounds, type Fire } from "../viewer/sound-schedule.ts";

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

const sound = (file: string, distance = "near") => ({ source: { kind: "curated", id: file }, file, distance });
const variantPlan = {
  soundtrack: { ambient: [sound("room.ogg", "mid")], oneshots: [{ ...sound("thunder.ogg", "far"), every: [90, 240] }] },
  variants: [
    { id: "night-rain", soundtrack: { ambient: [sound("rain.ogg")] } },
    { id: "clear-night", soundtrack: { ambient: [sound("wind.ogg", "far")], oneshots: [{ ...sound("owl.ogg", "far"), every: [30, 60] }] } },
    { id: "plain" },
  ],
} as any;
const [rainy, clear, plain] = variantPlan.variants;

test("a Variant plays the base sounds plus its own, each with a seed index after the base ones", () => {
  const sounds = variantSounds(variantPlan, clear);
  assert.deepEqual(sounds.ambient.map((s) => [s.entry.file, s.index, s.base]), [["room.ogg", 0, true], ["wind.ogg", 1, false]]);
  assert.deepEqual(sounds.oneshots.map((s) => [s.entry.file, s.index, s.base]), [["thunder.ogg", 0, true], ["owl.ogg", 1, false]]);
  assert.deepEqual(variantSounds(variantPlan, plain).ambient.map((s) => s.entry.file), ["room.ogg"]);
});

test("switching Variants keeps the base sounds and crossfades the added ones over about two seconds", () => {
  const fade = crossfade(variantPlan, rainy, clear);
  assert.ok(CROSSFADE_SEC >= 1.5 && CROSSFADE_SEC <= 2.5, `${CROSSFADE_SEC} s`);
  const files = (slots: { entry: { file: string } }[]) => slots.map((s) => s.entry.file).sort();
  assert.deepEqual(files(fade.keep), ["room.ogg", "thunder.ogg"]);
  assert.deepEqual(files(fade.fadeIn), ["owl.ogg", "wind.ogg"]);
  assert.deepEqual(files(fade.fadeOut), ["rain.ogg"]);
});

test("switching to the same Variant changes nothing", () => {
  const fade = crossfade(variantPlan, clear, clear);
  assert.deepEqual([fade.fadeIn, fade.fadeOut], [[], []]);
  assert.equal(fade.keep.length, 4);
});
