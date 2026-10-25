import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createAudio, hasAmbientSound, playSoundtrack } from "../viewer/audio.ts";

class FakeNode {
  readonly outputs: FakeNode[] = [];
  connect(to: FakeNode) {
    this.outputs.push(to);
    return to;
  }
  disconnect() {
    this.outputs.length = 0;
  }
}

class FakeParam {
  value = 1;
  readonly ramps: [number, number][] = [];
  setValueAtTime(value: number, _at: number) {
    this.value = value;
  }
  linearRampToValueAtTime(value: number, at: number) {
    this.ramps.push([value, at]);
  }
  cancelScheduledValues() {
    this.ramps.length = 0;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = "";
  readonly frequency = { value: 0 };
}

class FakeSource extends FakeNode {
  buffer: { duration: number; file: string } | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  readonly context: FakeContext;
  constructor(context: FakeContext) {
    super();
    this.context = context;
  }
  stoppedAt: number | undefined;
  start() {
    this.context.started.push(this);
  }
  stop(when = 0) {
    this.stoppedAt = when;
  }
}

class FakeContext {
  readonly destination = new FakeNode();
  readonly started: FakeSource[] = [];
  currentTime = 0;
  state: "running" | "suspended" = "suspended";
  createGain() {
    return new FakeGain();
  }
  createBiquadFilter() {
    return new FakeFilter();
  }
  createBufferSource() {
    return new FakeSource(this);
  }
  async decodeAudioData(bytes: ArrayBuffer) {
    return { duration: 2, file: new TextDecoder().decode(bytes) };
  }
  async resume() {
    this.state = "running";
  }
  async suspend() {
    this.state = "suspended";
  }
}

function loudness(context: FakeContext, from: FakeNode): number {
  if (from === context.destination) return 1;
  const own = from instanceof FakeGain ? from.gain.value : 1;
  return from.outputs.reduce((sum, to) => sum + own * loudness(context, to), 0);
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

function plan(soundtrack: object, variants: object[] = [{ id: "night" }]) {
  return {
    seed: 1337,
    variants,
    soundtrack: {
      music: { brief: "piano", service: "s", file: "music.mp3", loopStart: 0, loopEnd: 2, gain: 0.6 },
      ambient: [
        { source: { kind: "curated", id: "a" }, file: "rain.ogg", distance: "near", gain: 0.8 },
        { source: { kind: "curated", id: "b" }, file: "room.ogg", distance: "mid" },
      ],
      oneshots: [{ source: { kind: "curated", id: "c" }, file: "thunder.ogg", distance: "far", every: [90, 240] }],
      ...soundtrack,
    },
  } as any;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

let server: Server;
let base: URL;

before(async () => {
  server = createServer((req, res) => res.end(req.url!.split("/").pop()));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/scenes/s/`);
});

after(() => server.close());

async function play(levels: { music: number; ambient: number }, scene = plan({}), variant = scene.variants[0]) {
  const context = new FakeContext();
  const audio = createAudio(levels, context as unknown as AudioContext);
  const soundtrack = await playSoundtrack(audio, scene, base, new AbortController().signal, variant);
  const byFile = () => Object.fromEntries(context.started.map((s) => [s.buffer!.file, round(loudness(context, s))]));
  return { context, audio, byFile, soundtrack };
}

test("at Music 1 and Ambient 1 each source plays at the plan's gain through its Distance bus", async () => {
  const { byFile } = await play({ music: 1, ambient: 1 });
  const gains = byFile();
  assert.equal(gains["music.mp3"], 0.6);
  assert.equal(gains["rain.ogg"], round(0.8 * 0.7));
  assert.equal(gains["room.ogg"], 0.35);
  assert.ok(gains["thunder.ogg"] >= 0.15 * 10 ** -0.1 && gains["thunder.ogg"] <= 0.15 * 10 ** 0.1, `${gains["thunder.ogg"]}`);
});

test("Music at 0.5 halves the music gain only", async () => {
  const full = (await play({ music: 1, ambient: 1 })).byFile();
  const { audio, byFile } = await play({ music: 1, ambient: 1 });
  audio.setLevel("music", 0.5);
  const half = byFile();
  assert.equal(half["music.mp3"], round(full["music.mp3"] / 2));
  for (const file of ["rain.ogg", "room.ogg", "thunder.ogg"]) assert.equal(half[file], full[file], file);
});

test("Ambient at 0.5 halves every Ambient loop and One-shot gain and leaves music alone", async () => {
  const full = (await play({ music: 1, ambient: 1 })).byFile();
  const { audio, byFile } = await play({ music: 1, ambient: 1 });
  audio.setLevel("ambient", 0.5);
  const half = byFile();
  assert.equal(half["music.mp3"], full["music.mp3"]);
  for (const file of ["rain.ogg", "room.ogg", "thunder.ogg"]) assert.equal(half[file], round(full[file] / 2), file);
});

test("the stored levels apply from the start", async () => {
  const full = (await play({ music: 1, ambient: 1 })).byFile();
  const quiet = (await play({ music: 0.5, ambient: 0 })).byFile();
  assert.equal(quiet["music.mp3"], round(full["music.mp3"] / 2));
  for (const file of ["rain.ogg", "room.ogg", "thunder.ogg"]) assert.equal(quiet[file], 0, file);
});

test("the master mute silences music and Ambient, and moving a slider does not unmute", async () => {
  const { context, audio } = await play({ music: 1, ambient: 1 });
  audio.setRunning(true);
  await Promise.resolve();
  assert.equal(context.state, "running");
  audio.setRunning(false);
  await Promise.resolve();
  assert.equal(context.state, "suspended");
  audio.setLevel("music", 0.8);
  audio.setLevel("ambient", 0.3);
  await Promise.resolve();
  assert.equal(context.state, "suspended");
});

test("the Scene plan is never written", async () => {
  const scene = plan({});
  const before = structuredClone(scene);
  deepFreeze(scene);
  const { audio } = await play({ music: 0.5, ambient: 0.5 }, scene);
  audio.setLevel("music", 0.2);
  audio.setLevel("ambient", 0.9);
  assert.deepEqual(scene, before);
});

test("a Scene has ambient sound when it has an Ambient loop or a One-shot", () => {
  assert.equal(hasAmbientSound(plan({})), true);
  assert.equal(hasAmbientSound(plan({ ambient: [] })), true);
  assert.equal(hasAmbientSound(plan({ oneshots: [] })), true);
  assert.equal(hasAmbientSound(plan({ ambient: [], oneshots: [] })), false);
  assert.equal(hasAmbientSound(plan({ ambient: [], oneshots: [] }, [{ id: "night" }, { id: "storm", soundtrack: { oneshots: [] } }])), false);
  assert.equal(hasAmbientSound(plan({ ambient: [], oneshots: [] }, [{ id: "night" }, { id: "storm", soundtrack: { ambient: [wind] } }])), true);
});

const wind = { source: { kind: "curated", id: "w" }, file: "wind.ogg", distance: "near" };
const owl = { source: { kind: "curated", id: "o" }, file: "owl.ogg", distance: "near", every: [30, 60] };
const withVariants = () => plan({}, [{ id: "night-rain" }, { id: "clear-night", soundtrack: { ambient: [wind], oneshots: [owl] } }]);

function fadeGain(source: FakeSource): FakeParam {
  let at: FakeNode = source;
  for (;;) {
    const next = at.outputs[0];
    if (next instanceof FakeGain && next.gain.ramps.length) return next.gain;
    if (!next) throw new Error(`no fading gain after ${source.buffer!.file}`);
    at = next;
  }
}

test("opened on a Variant, its added loop plays at the plan's gain from the start alongside the base", async () => {
  const scene = withVariants();
  const { byFile } = await play({ music: 1, ambient: 1 }, scene, scene.variants[1]);
  const gains = byFile();
  assert.equal(gains["wind.ogg"], 0.7);
  assert.equal(gains["rain.ogg"], round(0.8 * 0.7));
  assert.ok(gains["owl.ogg"] > 0);
});

test("switching to a Variant crossfades its added loop in over about two seconds and the base loops keep playing", async () => {
  const scene = withVariants();
  const { context, soundtrack } = await play({ music: 1, ambient: 1 }, scene);
  const baseSources = [...context.started];
  context.currentTime = 10;
  soundtrack.setVariant(scene.variants[1]);
  const added = context.started.slice(baseSources.length);
  assert.deepEqual(added.map((s) => s.buffer!.file).sort(), ["owl.ogg", "wind.ogg"]);
  const loop = added.find((s) => s.buffer!.file === "wind.ogg")!;
  assert.equal(loop.loop, true);
  const fade = fadeGain(loop);
  assert.equal(fade.value, 0);
  assert.deepEqual(fade.ramps, [[1, 12]]);
  assert.ok(baseSources.every((s) => s.stoppedAt === undefined), "a base source stopped");
});

test("switching back fades the added loop out over the crossfade and stops it, leaving the base untouched", async () => {
  const scene = withVariants();
  const { context, soundtrack } = await play({ music: 1, ambient: 1 }, scene);
  const baseCount = context.started.length;
  soundtrack.setVariant(scene.variants[1]);
  const loop = context.started.find((s) => s.buffer!.file === "wind.ogg")!;
  context.currentTime = 20;
  soundtrack.setVariant(scene.variants[0]);
  assert.deepEqual(fadeGain(loop).ramps, [[0, 22]]);
  assert.equal(loop.stoppedAt, 22);
  assert.ok(context.started.slice(0, baseCount).every((s) => s.stoppedAt === undefined), "a base source stopped");
});
