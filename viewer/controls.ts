import type { ScenePlan } from "../schema/index.ts";
import { aiNotice, type Credits } from "./credits.ts";
import type { MuteState } from "./mute.ts";
import { sceneUrl } from "./site.ts";

export const OVERLAY_HIDE_MS = 3000;
const COPIED_MS = 2000;

export type ControlsOptions = {
  plan: ScenePlan;
  root: URL;
  mute: MuteState;
  credits: Promise<Credits>;
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

export function fullscreenSupported(): boolean {
  return document.fullscreenEnabled && !/iPhone|iPod/.test(navigator.userAgent);
}

function link(text: string, href: string): HTMLAnchorElement {
  const el = document.createElement("a");
  el.href = href;
  el.target = "_blank";
  el.rel = "noopener";
  el.textContent = text;
  return el;
}

function infoPanel(plan: ScenePlan, credits: Promise<Credits>, close: () => void): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "info";
  panel.setAttribute("aria-label", "About this Scene");
  const heading = document.createElement("h2");
  heading.textContent = plan.title;
  const prompt = document.createElement("blockquote");
  prompt.textContent = plan.prompt;
  const notice = document.createElement("p");
  const attributions = document.createElement("ul");
  credits.then(
    ({ services, attributions: lines }) => {
      notice.textContent = aiNotice(services);
      for (const line of lines) {
        const item = document.createElement("li");
        item.append(link(line.attribution, line.sourceUrl), " · ", link(line.licence, line.licenceUrl));
        attributions.append(item);
      }
    },
    () => (notice.textContent = aiNotice([])),
  );
  panel.append(heading, prompt, notice, attributions, button("Close", close));
  return panel;
}

function toggleFullscreen(mute: MuteState): void {
  mute.set(false);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

export function mountControls(host: HTMLElement, { plan, root, mute, credits, navigate, signal }: ControlsOptions): void {
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
  const canFullscreen = fullscreenSupported();
  overlay.append(back, title, sound);
  if (canFullscreen) overlay.append(button("Fullscreen", () => toggleFullscreen(mute)));
  const copy = button("Copy link", () => {
    navigator.clipboard.writeText(sceneUrl(root, plan.id).href).then(
      () => flash("Copied"),
      () => flash("Copy failed"),
    );
  });
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  const flash = (label: string) => {
    copy.textContent = label;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copy.textContent = "Copy link"), COPIED_MS);
  };
  let info: HTMLElement | undefined;
  const toggleInfo = () => {
    if (info) {
      info.remove();
      info = undefined;
    } else {
      info = infoPanel(plan, credits, toggleInfo);
      host.append(info);
    }
  };
  overlay.append(copy, button("Info", toggleInfo));

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
      if (mute.everUnmuted || overlay.contains(e.target as Node) || info?.contains(e.target as Node)) return;
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
        case "f":
          if (!canFullscreen) return;
          toggleFullscreen(mute);
          break;
        case "i":
          toggleInfo();
          break;
        case "escape":
          if (document.fullscreenElement) return;
          navigate(root);
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
  signal.addEventListener("abort", () => {
    clearTimeout(hideTimer);
    clearTimeout(copyTimer);
  });
}
