import {
  allPlacements,
  elementRecordSchema,
  paletteSchema,
  POSTER_FILE,
  SCENE_HEIGHT,
  SCENE_WIDTH,
  scenePlanSchema,
  type ScenePlan,
} from "../schema/index.ts";
import { playSoundtrack, type Audio } from "./audio.ts";
import { mountControls } from "./controls.ts";
import { loadCredits } from "./credits.ts";
import { createCompositor, type ElementPixels, type Pixels } from "./compositor.ts";
import { fetchJson, fetchOk, NotFound } from "./http.ts";
import { startLoop } from "./loop.ts";
import { createPrimitives } from "./primitives.ts";
import type { MuteState } from "./mute.ts";
import { sceneUrl } from "./site.ts";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

async function decode(url: URL): Promise<Pixels> {
  const blob = await (await fetchOk(url)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}

async function loadElements(root: URL, plan: ScenePlan): Promise<Map<string, ElementPixels>> {
  const ids = new Set(allPlacements(plan).map((p) => p.element));
  const loaded = await Promise.all(
    [...ids].map(async (id): Promise<[string, ElementPixels]> => {
      const base = new URL(`library/elements/${id}`, root);
      const record = elementRecordSchema.parse(await fetchJson(new URL(`${base.href}.json`)));
      const still = await decode(new URL(`${base.href}.png`));
      if (record.kind !== "prop" || !record.animation) return [id, { still }];
      const { frames, fps, order } = record.animation;
      return [id, { still, strip: { image: await decode(new URL(`${base.href}.strip.png`)), frames, fps, order } }];
    }),
  );
  return new Map(loaded);
}

function fitToViewport(elements: HTMLElement[], signal: AbortSignal): void {
  let dprQuery: MediaQueryList | undefined;
  const fit = () => {
    const dpr = devicePixelRatio || 1;
    const scale = Math.max(1, Math.floor(Math.min((innerWidth * dpr) / SCENE_WIDTH, (innerHeight * dpr) / SCENE_HEIGHT)));
    for (const el of elements) {
      el.style.width = `${(scale * SCENE_WIDTH) / dpr}px`;
      el.style.height = `${(scale * SCENE_HEIGHT) / dpr}px`;
    }
    dprQuery?.removeEventListener("change", fit);
    dprQuery = matchMedia(`(resolution: ${dpr}dppx)`);
    dprQuery.addEventListener("change", fit, { signal });
  };
  addEventListener("resize", fit, { signal });
  document.addEventListener("fullscreenchange", fit, { signal });
  fit();
}

export function renderMissing(host: HTMLElement, root: URL): void {
  const main = document.createElement("main");
  main.className = "missing";
  const heading = document.createElement("h1");
  heading.textContent = "No such Scene";
  const link = document.createElement("a");
  link.href = root.href;
  link.textContent = "Back to the Gallery";
  main.append(heading, link);
  host.replaceChildren(main);
  document.title = "No such Scene";
}

export type SceneSession = { mute: MuteState; audio: Audio; navigate: (url: URL) => void };

export async function renderScene(
  host: HTMLElement,
  root: URL,
  id: string,
  signal: AbortSignal,
  { mute, audio, navigate }: SceneSession,
): Promise<void> {
  const base = sceneUrl(root, id);
  let plan: ScenePlan;
  try {
    plan = scenePlanSchema.parse(await fetchJson(new URL("scene.json", base)));
  } catch (e) {
    if (signal.aborted) return;
    if (e instanceof NotFound) return renderMissing(host, root);
    throw e;
  }
  if (signal.aborted) return;

  const main = document.createElement("main");
  main.className = "scene";
  const poster = document.createElement("img");
  poster.src = new URL(POSTER_FILE, base).href;
  poster.alt = plan.title;
  main.append(poster);
  host.replaceChildren(main);
  document.title = plan.title;
  fitToViewport([poster], signal);
  const credits = loadCredits(root, plan);
  credits.catch((e) => console.error(e));
  mountControls(main, { plan, root, mute, audio, credits, navigate, signal });

  const palette = paletteSchema.parse(await fetchJson(new URL(`library/palettes/${plan.palette}.json`, root)));
  if (signal.aborted) return;
  document.body.style.background = palette.colours[0];
  const startSound = () =>
    playSoundtrack(audio, plan, base, signal).catch((e) => {
      if (!signal.aborted) console.error(e);
    });
  if (reducedMotion.matches) return void startSound();

  const elements = await loadElements(root, plan);
  if (signal.aborted) return;
  const compositor = createCompositor({ plan, elements, palette, primitives: createPrimitives({ plan, elements, palette }) });
  const canvas = document.createElement("canvas");
  canvas.width = SCENE_WIDTH;
  canvas.height = SCENE_HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  let image: ImageData | undefined;
  fitToViewport([canvas], signal);
  startLoop(
    compositor,
    (frame) => {
      image ??= new ImageData(frame, SCENE_WIDTH, SCENE_HEIGHT);
      ctx.putImageData(image, 0, 0);
      if (poster.isConnected) poster.replaceWith(canvas);
    },
    signal,
  );
  startSound();
}
