import { activePrimitives, type ScenePlan, type Variant } from "../schema/index.ts";
import { flashTimes } from "./primitives.ts";
import { random } from "./random.ts";

export const DISTANCE_BUSES = {
  near: { gain: 0.7 },
  mid: { gain: 0.35, lowpassHz: 5000 },
  far: { gain: 0.15, lowpassHz: 1200 },
} as const;

export const CROSSFADE_SEC = 2;

const ONESHOT_SALT = 0x0e5407;
const LOOP_SALT = 0x100f;
const GAIN_JITTER_DB = 2;
const RATE_JITTER = 0.03;

export type Fire = { at: number; gain: number; rate: number };

function jitter(seed: number, index: number, k: number): Omit<Fire, "at"> {
  const db = (random(seed, ONESHOT_SALT, index, k, 1) * 2 - 1) * GAIN_JITTER_DB;
  const rate = 1 + (random(seed, ONESHOT_SALT, index, k, 2) * 2 - 1) * RATE_JITTER;
  return { gain: 10 ** (db / 20), rate };
}

export function* oneshotFires(seed: number, index: number, [min, max]: readonly [number, number]): Generator<Fire, never> {
  let at = 0;
  for (let k = 0; ; k++) {
    at += min + random(seed, ONESHOT_SALT, index, k, 0) * (max - min);
    yield { at, ...jitter(seed, index, k) };
  }
}

export type FollowedFlash = { salt: number; every: readonly [number, number] };

export function followedFlash(plan: Pick<ScenePlan, "primitives">, variant: Pick<Variant, "primitives">): FollowedFlash | undefined {
  const active = activePrimitives(plan, variant);
  const salt = active.findIndex((p) => p.type === "flash");
  const flash = active[salt];
  return flash?.type === "flash" ? { salt, every: flash.every } : undefined;
}

// Fire k plays a seeded delay after flash k starts, in Scene seconds.
export function* followFires(seed: number, index: number, flash: FollowedFlash, [min, max]: readonly [number, number]): Generator<Fire, never> {
  const starts = flashTimes(seed, flash.salt, flash.every);
  for (let k = 0; ; k++) {
    const start = starts.next().value;
    yield { at: start + min + random(seed, ONESHOT_SALT, index, k, 0) * (max - min), ...jitter(seed, index, k) };
  }
}

export function loopOffset(seed: number, index: number, durationSec: number): number {
  return random(seed, LOOP_SALT, index, 0, 0) * durationSec;
}

type Soundtrack = ScenePlan["soundtrack"];
export type SoundSlot<E> = { key: string; entry: E; index: number; base: boolean };
export type VariantSounds = { ambient: SoundSlot<Soundtrack["ambient"][number]>[]; oneshots: SoundSlot<Soundtrack["oneshots"][number]>[] };
type SoundsPlan = { soundtrack: Pick<Soundtrack, "ambient" | "oneshots">; variants: readonly Pick<Variant, "id" | "soundtrack">[] };

function slots<E>(list: "ambient" | "oneshots", base: readonly E[], variant: Pick<Variant, "id">, added: readonly E[] = []): SoundSlot<E>[] {
  return [
    ...base.map((entry, i) => ({ key: `base:${list}:${i}`, entry, index: i, base: true })),
    ...added.map((entry, j) => ({ key: `${variant.id}:${list}:${j}`, entry, index: base.length + j, base: false })),
  ];
}

export function variantSounds(plan: SoundsPlan, variant: Pick<Variant, "id" | "soundtrack">): VariantSounds {
  return {
    ambient: slots("ambient", plan.soundtrack.ambient, variant, variant.soundtrack?.ambient),
    oneshots: slots("oneshots", plan.soundtrack.oneshots, variant, variant.soundtrack?.oneshots),
  };
}

type AnySlot = VariantSounds["ambient"][number] | VariantSounds["oneshots"][number];
export type Crossfade = { keep: AnySlot[]; fadeIn: AnySlot[]; fadeOut: AnySlot[] };

export function variantSlots(plan: SoundsPlan, variant: Pick<Variant, "id" | "soundtrack">): AnySlot[] {
  const { ambient, oneshots } = variantSounds(plan, variant);
  return [...ambient, ...oneshots];
}

export function crossfade(plan: SoundsPlan, from: Pick<Variant, "id" | "soundtrack">, to: Pick<Variant, "id" | "soundtrack">): Crossfade {
  const before = variantSlots(plan, from);
  const after = variantSlots(plan, to);
  const had = new Set(before.map((s) => s.key));
  const has = new Set(after.map((s) => s.key));
  return {
    keep: after.filter((s) => had.has(s.key)),
    fadeIn: after.filter((s) => !had.has(s.key)),
    fadeOut: before.filter((s) => !has.has(s.key)),
  };
}
