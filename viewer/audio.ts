import type { ScenePlan } from "../schema/index.ts";
import { fetchOk } from "./http.ts";
import type { Channel } from "./settings.ts";
import { DISTANCE_BUSES, loopOffset, oneshotFires } from "./sound-schedule.ts";

type Distance = keyof typeof DISTANCE_BUSES;

export type Levels = Record<Channel, number>;

export type Audio = {
  readonly context: AudioContext;
  readonly buses: Readonly<Record<Channel, GainNode>>;
  level(channel: Channel): number;
  setLevel(channel: Channel, level: number): void;
  setRunning(running: boolean): void;
};

export function hasAmbientSound(plan: Pick<ScenePlan, "soundtrack">): boolean {
  return plan.soundtrack.ambient.length + plan.soundtrack.oneshots.length > 0;
}

export function createAudio(levels: Levels, context: AudioContext = new AudioContext()): Audio {
  const bus = (level: number) => {
    const node = context.createGain();
    node.gain.value = level;
    node.connect(context.destination);
    return node;
  };
  const buses = { music: bus(levels.music), ambient: bus(levels.ambient) };
  return {
    context,
    buses,
    level: (channel) => buses[channel].gain.value,
    setLevel(channel, level) {
      buses[channel].gain.value = level;
    },
    setRunning(running) {
      (running ? context.resume() : context.suspend()).catch(() => {});
    },
  };
}

export async function playSoundtrack({ context, buses: channels }: Audio, plan: ScenePlan, base: URL, signal: AbortSignal): Promise<void> {
  const { music, ambient, oneshots } = plan.soundtrack;
  const decode = async (file: string) => context.decodeAudioData(await (await fetchOk(new URL(file, base))).arrayBuffer());
  const [musicBuffer, ambientBuffers, oneshotBuffers] = await Promise.all([
    music.file ? decode(music.file) : undefined,
    Promise.all(ambient.map((a) => decode(a.file))),
    Promise.all(oneshots.map((o) => decode(o.file))),
  ]);
  if (signal.aborted) return;

  const nodes = new Set<AudioNode>();
  const sources = new Set<AudioBufferSourceNode>();
  const gain = (value: number, to: AudioNode) => {
    const node = context.createGain();
    node.gain.value = value;
    node.connect(to);
    nodes.add(node);
    return node;
  };
  const source = (buffer: AudioBuffer, to: AudioNode) => {
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(to);
    sources.add(node);
    return node;
  };
  const busInput = (distance: Distance): AudioNode => {
    const spec = DISTANCE_BUSES[distance];
    const out = gain(spec.gain, channels.ambient);
    if (!("lowpassHz" in spec)) return out;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = spec.lowpassHz;
    filter.connect(out);
    nodes.add(filter);
    return filter;
  };
  const buses = { near: busInput("near"), mid: busInput("mid"), far: busInput("far") };
  const startAt = context.currentTime;

  if (musicBuffer) {
    const node = source(musicBuffer, gain(music.gain, channels.music));
    node.loop = true;
    node.loopStart = music.loopStart ?? 0;
    node.loopEnd = music.loopEnd ?? musicBuffer.duration;
    node.start(startAt);
  }

  ambient.forEach((entry, i) => {
    const buffer = ambientBuffers[i];
    const node = source(buffer, gain(entry.gain ?? 1, buses[entry.distance]));
    node.loop = true;
    node.start(startAt, loopOffset(plan.seed, i, buffer.duration));
  });

  oneshots.forEach((entry, i) => {
    const fires = oneshotFires(plan.seed, i, entry.every);
    // Chained on each fire's ended event rather than a timer, so firing continues in a hidden tab.
    const scheduleNext = () => {
      const fire = fires.next().value;
      const level = gain((entry.gain ?? 1) * fire.gain, buses[entry.distance]);
      const node = source(oneshotBuffers[i], level);
      node.playbackRate.value = fire.rate;
      node.onended = () => {
        sources.delete(node);
        nodes.delete(level);
        node.disconnect();
        level.disconnect();
        if (!signal.aborted) scheduleNext();
      };
      node.start(Math.max(startAt + fire.at, context.currentTime));
    };
    scheduleNext();
  });

  signal.addEventListener("abort", () => {
    for (const node of sources) {
      node.onended = null;
      node.stop();
      node.disconnect();
    }
    for (const node of nodes) node.disconnect();
  });
}
