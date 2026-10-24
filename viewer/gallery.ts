import { POSTER_FILE, SCENE_HEIGHT, SCENE_WIDTH, type GalleryEntry } from "../schema/index.ts";
import { AI_NOTICE } from "./credits.ts";
import { sceneUrl } from "./site.ts";

const POSTER_SCALE = 2;

async function readGallery(root: URL): Promise<GalleryEntry[]> {
  const response = await fetch(new URL("gallery.json", root));
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`gallery.json: HTTP ${response.status}`);
  return response.json();
}

export async function renderGallery(host: HTMLElement, root: URL, signal: AbortSignal): Promise<void> {
  const entries = await readGallery(root);
  if (signal.aborted) return;
  const dpr = devicePixelRatio || 1;
  const scale = Math.max(1, Math.round(POSTER_SCALE * dpr));

  const main = document.createElement("main");
  main.className = "gallery";
  const grid = document.createElement("ul");
  for (const entry of entries) {
    const href = sceneUrl(root, entry.id);
    const link = document.createElement("a");
    link.href = href.href;
    link.dataset.scene = entry.id;
    const poster = document.createElement("img");
    poster.src = new URL(POSTER_FILE, href).href;
    poster.alt = entry.title;
    poster.width = (SCENE_WIDTH * scale) / dpr;
    poster.height = (SCENE_HEIGHT * scale) / dpr;
    const caption = document.createElement("span");
    caption.textContent = entry.title;
    link.append(poster, caption);
    const item = document.createElement("li");
    item.append(link);
    grid.append(item);
  }
  if (entries.length === 0) grid.append(Object.assign(document.createElement("li"), { textContent: "No Scenes yet." }));
  main.append(grid);

  const footer = document.createElement("footer");
  footer.textContent = AI_NOTICE;
  host.replaceChildren(main, footer);
  document.title = "Pixel Art Scenes";
}
