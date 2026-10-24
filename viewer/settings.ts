const SOUND_ON_KEY = "pixel-art:sound-on";
const VOLUME_KEY = "pixel-art:volume";
const DEFAULT_VOLUME = 1;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function storedSoundOn(): boolean {
  return read(SOUND_ON_KEY) === "true";
}

export function storeSoundOn(on: boolean): void {
  write(SOUND_ON_KEY, String(on));
}

export function storedVolume(): number {
  const stored = read(VOLUME_KEY);
  const volume = stored === null ? NaN : Number(stored);
  return volume >= 0 && volume <= 1 ? volume : DEFAULT_VOLUME;
}

export function storeVolume(volume: number): void {
  write(VOLUME_KEY, String(volume));
}
