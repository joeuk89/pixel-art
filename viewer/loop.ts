import type { Compositor } from "./compositor.ts";

const MAX_RESUME_DELTA_MS = 100;

// now() is the Scene time in seconds, or undefined while the Scene is not advancing.
export type Loop = { swap(next: Compositor): void; now(): number | undefined };

export function startLoop(compositor: Compositor, draw: (frame: Uint8ClampedArray) => void, signal: AbortSignal): Loop {
  let sceneTime = 0;
  let last = performance.now();
  let clampNext = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let raf = 0;

  const cancel = () => {
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    timer = undefined;
    raf = 0;
  };

  const timeAt = (now: number) => {
    const delta = Math.max(0, now - last);
    return sceneTime + (clampNext ? Math.min(delta, MAX_RESUME_DELTA_MS) : delta);
  };

  const frame = (now: number) => {
    raf = 0;
    sceneTime = timeAt(now);
    last = now;
    clampNext = false;
    if (compositor.tick(sceneTime)) draw(compositor.render(sceneTime));
    schedule();
  };

  const schedule = () => {
    const wait = compositor.nextTick(sceneTime) - sceneTime;
    if (!Number.isFinite(wait)) return;
    timer = setTimeout(() => {
      timer = undefined;
      raf = requestAnimationFrame(frame);
    }, Math.max(0, wait));
  };

  const resume = () => {
    if (timer !== undefined || raf !== 0) return;
    clampNext = true;
    raf = requestAnimationFrame(frame);
  };

  document.addEventListener("visibilitychange", () => (document.hidden ? cancel() : resume()), { signal });
  signal.addEventListener("abort", cancel);
  if (!document.hidden) raf = requestAnimationFrame(frame);
  return {
    swap(next) {
      compositor = next;
      if (signal.aborted || document.hidden) return;
      cancel();
      raf = requestAnimationFrame(frame);
    },
    now() {
      if (document.hidden || (timer === undefined && raf === 0)) return undefined;
      return timeAt(performance.now()) / 1000;
    },
  };
}
