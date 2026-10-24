export type Channel = "music" | "ambient";
export type Store = Pick<Storage, "getItem" | "setItem">;

const SOUND_ON_KEY = "pixel-art:sound-on";
const LEVEL_KEYS: Record<Channel, string> = { music: "pixel-art:music", ambient: "pixel-art:ambient" };
const DEFAULT_LEVEL = 1;

function browserStore(): Store | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

function read(key: string, store = browserStore()): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string, store = browserStore()): void {
  try {
    store?.setItem(key, value);
  } catch {}
}

export function storedSoundOn(): boolean {
  return read(SOUND_ON_KEY) === "true";
}

export function storeSoundOn(on: boolean): void {
  write(SOUND_ON_KEY, String(on));
}

export function storedLevel(channel: Channel, store?: Store): number {
  const stored = read(LEVEL_KEYS[channel], store);
  const level = stored === null || stored.trim() === "" ? NaN : Number(stored);
  return level >= 0 && level <= 1 ? level : DEFAULT_LEVEL;
}

export function storeLevel(channel: Channel, level: number, store?: Store): void {
  write(LEVEL_KEYS[channel], String(level), store);
}
