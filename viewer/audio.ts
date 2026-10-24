import type { ScenePlan, Variant } from "../schema/index.ts";
import { fetchOk } from "./http.ts";
import type { Channel } from "./settings.ts";
import { CROSSFADE_SEC, crossfade, DISTANCE_BUSES, loopOffset, oneshotFires, variantSounds, type VariantSounds } from "./sound-schedule.ts";

type Distance = keyof typeof DISTANCE_BUSES;

export type Levels = Record<Channel, number>;

export type Audio = {
  readonly context: AudioContext;
  readonly buses: Readonly<Record<Channel, GainNode>>;
  level(channel: Channel): number;
  setLevel(channel: Channel, level: number): void;
  setRunning(running: boolean): void;
};

export function hasAmbientSound(plan: Pick<ScenePlan, "soundtrack" | "variants">): boolean {
  return plan.variants.some((v) => {
    const { ambient, oneshots } = variantSounds(plan, v);
    return ambient.length + oneshots.length > 0;
  });
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

export type Soundtrack = { setVariant(variant: Variant): void };

type Playing = { fade: GainNode; stop(at: number): void };

export async function playSoundtrack(
  { context, buses: channels }: Audio,
  plan: ScenePlan,
  base: URL,
  signal: AbortSignal,
  variant: Variant = plan.variants[0],
): Promise<Soundtrack> {
  const { music } = plan.soundtrack;
  const files = new Set(plan.variants.flatMap((v) => {
    const { ambient, oneshots } = variantSounds(plan, v);
    return [...ambient, ...oneshots].map((slot) => slot.entry.file);
  }));
  const decode = async (file: string) => context.decodeAudioData(await (await fetchOk(new URL(file, base))).arrayBuffer());
  const [musicBuffer, buffers] = await Promise.all([
    music.file ? decode(music.file) : undefined,
    Promise.all([...files].map(async (file) => [file, await decode(file)] as const)).then((pairs) => new Map(pairs)),
  ]);
  if (signal.aborted) return { setVariant() {} };

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

  const playLoop = ({ entry, index }: VariantSounds["ambient"][number], to: AudioNode, at: number) => {
    const buffer = buffers.get(entry.file)!;
    const node = source(buffer, gain(entry.gain ?? 1, to));
    node.loop = true;
    node.start(at, loopOffset(plan.seed, index, buffer.duration));
    return (when: number) => node.stop(when);
  };

  const playOneshot = ({ entry, index }: VariantSounds["oneshots"][number], to: AudioNode, at: number) => {
    const fires = oneshotFires(plan.seed, index, entry.every);
    let stopped = false;
    let pending: AudioBufferSourceNode | undefined;
    // Chained on each fire's ended event rather than a timer, so firing continues in a hidden tab.
    const scheduleNext = () => {
      const fire = fires.next().value;
      const level = gain((entry.gain ?? 1) * fire.gain, to);
      const node = source(buffers.get(entry.file)!, level);
      node.playbackRate.value = fire.rate;
      node.onended = () => {
        sources.delete(node);
        nodes.delete(level);
        node.disconnect();
        level.disconnect();
        if (!signal.aborted && !stopped) scheduleNext();
      };
      pending = node;
      node.start(Math.max(at + fire.at, context.currentTime));
    };
    scheduleNext();
    return (when: number) => {
      stopped = true;
      pending?.stop(when);
    };
  };

  const playing = new Map<string, Playing>();
  const play = (variant: Variant, fadeIn: boolean) => {
    const now = context.currentTime;
    const at = fadeIn ? now : startAt;
    const { ambient, oneshots } = variantSounds(plan, variant);
    for (const slot of [...ambient, ...oneshots]) {
      if (playing.has(slot.key)) continue;
      const bus = buses[slot.entry.distance];
      const fade = gain(1, bus);
      if (fadeIn) {
        fade.gain.setValueAtTime(0, now);
        fade.gain.linearRampToValueAtTime(1, now + CROSSFADE_SEC);
      }
      const stop = "every" in slot.entry
        ? playOneshot(slot as VariantSounds["oneshots"][number], fade, at)
        : playLoop(slot as VariantSounds["ambient"][number], fade, at);
      playing.set(slot.key, { fade, stop });
    }
  };

  let current = variant;
  play(current, false);

  signal.addEventListener("abort", () => {
    for (const node of sources) {
      node.onended = null;
      node.stop();
      node.disconnect();
    }
    for (const node of nodes) node.disconnect();
  });

  return {
    setVariant(next) {
      if (signal.aborted || next === current) return;
      const { fadeOut } = crossfade(plan, current, next);
      const now = context.currentTime;
      for (const slot of fadeOut) {
        const sound = playing.get(slot.key);
        if (!sound) continue;
        playing.delete(slot.key);
        sound.fade.gain.cancelScheduledValues(now);
        sound.fade.gain.setValueAtTime(sound.fade.gain.value, now);
        sound.fade.gain.linearRampToValueAtTime(0, now + CROSSFADE_SEC);
        sound.stop(now + CROSSFADE_SEC);
      }
      current = next;
      play(current, true);
    },
  };
}
