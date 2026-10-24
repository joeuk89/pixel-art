import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { makeTree, readJson, repo, writeJson } from "./helpers.ts";
import { runScript, startFixtureServer, type FixtureServer } from "./fixture-server.ts";
import { decodePng, pixellabState, type Rgba } from "./fixtures/services/pixellab.ts";

const script = join(repo, "pipeline/generate-strip.ts");
const ELEMENT = "cat-tabby-twitching-01";
const ELEMENTS = "library/elements";

let server: FixtureServer;
before(async () => { server = await startFixtureServer(); });
after(() => server.close());
beforeEach(() => pixellabState.reset());

function tree(): string {
  const root = makeTree();
  const record = readJson(root, `${ELEMENTS}/cat-tabby-asleep-01.json`);
  delete record.animation;
  writeJson(root, `${ELEMENTS}/${ELEMENT}.json`, { ...record, id: ELEMENT });
  copyFileSync(join(root, `${ELEMENTS}/cat-tabby-asleep-01.png`), join(root, `${ELEMENTS}/${ELEMENT}.png`));
  return root;
}

const run = (root: string, ...args: string[]) => runScript(script, [ELEMENT, ...args], { cwd: root, env: server.env });

async function decode(path: string): Promise<Rgba> {
  return decodePng(readFileSync(path));
}

function frameOf(strip: Rgba, k: number, width: number): Uint8Array {
  const out = new Uint8Array(width * strip.height * 4);
  for (let y = 0; y < strip.height; y++) {
    out.set(strip.data.subarray((y * strip.width + k * width) * 4, (y * strip.width + (k + 1) * width) * 4), y * width * 4);
  }
  return out;
}

test("a PixelLab run yields exactly the asked frames with the still as frame 0 and no duplicated still", async () => {
  const root = tree();
  const result = await run(root);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.json.service, "pixellab");
  assert.equal(result.json.frames, 4);
  assert.equal(pixellabState.animateRequests[0].frame_count, 3);

  const strip = await decode(join(root, result.json.scratch.strip));
  assert.deepEqual([strip.width, strip.height], [96, 16]);
  const still = await decode(join(root, `${ELEMENTS}/${ELEMENT}.png`));
  assert.deepEqual(frameOf(strip, 0, 24), still.data);
  for (let k = 1; k < 4; k++) assert.notDeepEqual(frameOf(strip, k, 24), still.data, `frame ${k} repeats the still`);
  assert.equal(result.json.gate.ok, true, JSON.stringify(result.json.gate));
  assert.deepEqual(result.json.gate.passed, ["dimensions", "alpha", "palette", "motion", "drift", "seam"]);
});
