export type MuteState = {
  readonly muted: boolean;
  readonly everUnmuted: boolean;
  set(muted: boolean): void;
  toggle(): void;
  onChange(listener: (muted: boolean) => void, signal?: AbortSignal): void;
};

export function createMuteState(muted = true): MuteState {
  let everUnmuted = !muted;
  const listeners = new Set<(muted: boolean) => void>();
  const state: MuteState = {
    get muted() {
      return muted;
    },
    get everUnmuted() {
      return everUnmuted;
    },
    set(next) {
      if (next === muted) return;
      muted = next;
      if (!muted) everUnmuted = true;
      for (const listener of listeners) listener(muted);
    },
    toggle() {
      state.set(!muted);
    },
    onChange(listener, signal) {
      listeners.add(listener);
      signal?.addEventListener("abort", () => listeners.delete(listener));
    },
  };
  return state;
}
