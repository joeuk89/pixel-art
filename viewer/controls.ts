import type { ScenePlan } from "../schema/index.ts";
import type { MuteState } from "./mute.ts";

export const OVERLAY_HIDE_MS = 3000;

export type ControlsOptions = {
  plan: ScenePlan;
  root: URL;
  mute: MuteState;
  navigate: (url: URL) => void;
  signal: AbortSignal;
};

function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.addEventListener("click", onClick);
  return el;
}

export function mountControls(host: HTMLElement, { plan, root, mute, signal }: ControlsOptions): void {
  const overlay = document.createElement("nav");
  overlay.className = "overlay";
  overlay.setAttribute("aria-label", "Scene controls");

  const back = document.createElement("a");
  back.href = root.href;
  back.textContent = "Back to the Gallery";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = plan.title;
  const sound = button("Sound", () => mute.toggle());
  overlay.append(back, title, sound, button("Copy link", () => {}), button("Info", () => {}));

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Click for sound";
  host.append(overlay, hint);

  const renderMute = () => {
    sound.setAttribute("aria-pressed", String(!mute.muted));
    if (mute.everUnmuted) hint.remove();
  };
  mute.onChange(renderMute, signal);
  renderMute();

  host.addEventListener(
    "click",
    (e) => {
      if (mute.everUnmuted || overlay.contains(e.target as Node)) return;
      mute.set(false);
    },
    { signal },
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      switch (e.key.toLowerCase()) {
        case "m":
          mute.toggle();
          break;
        default:
          return;
      }
      e.preventDefault();
    },
    { signal },
  );

  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const show = () => {
    host.classList.add("controls-shown");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => host.classList.remove("controls-shown"), OVERLAY_HIDE_MS);
  };
  host.addEventListener("pointermove", show, { signal });
  host.addEventListener("pointerdown", show, { signal });
  signal.addEventListener("abort", () => clearTimeout(hideTimer));
}
