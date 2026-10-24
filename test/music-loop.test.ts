import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMusicLoop, seamPasses } from "../pipeline/lib/music-loop.ts";
import { seamReport, type Wav } from "../pipeline/lib/audio.ts";
import { synthMusic } from "./fixtures/services/synth-music.ts";

const source: Wav = synthMusic(135, 44100);

test("the loop maker keeps a 105 to 115 s region inside the 8 s trims", () => {
  const made = makeMusicLoop(source);
  const loopSec = made.loop.data[0].length / source.rate;
  assert.ok(loopSec >= 105 && loopSec <= 115, `loop is ${loopSec} s`);
  assert.equal(made.loopSamples, made.loop.data[0].length);
  assert.ok(made.regionStartSec >= 8, `starts at ${made.regionStartSec} s`);
  assert.ok(made.regionEndSec + 4 <= 135 - 8, `ends at ${made.regionEndSec} s`);
  assert.equal(made.loop.ch, 2);
});

test("the crossfaded loop wraps with a step no larger than any inside it, where a plain cut does not", () => {
  const made = makeMusicLoop(source);
  assert.ok(made.seam.seamJump <= made.seam.maxInnerJump, JSON.stringify(made.seam));
  assert.ok(seamPasses(made.seam));

  const start = Math.round(made.regionStartSec * source.rate);
  const cut: Wav = { rate: source.rate, ch: source.ch, data: source.data.map((c) => c.slice(start, start + made.loopSamples)) };
  assert.equal(seamPasses(seamReport(cut)), false, JSON.stringify(seamReport(cut)));
});

test("a source too short for a 105 s loop is refused", () => {
  assert.throws(() => makeMusicLoop(synthMusic(100, 8000)), /too short/);
});
