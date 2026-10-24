import { scenePlanSchema, type ScenePlan } from "../schema/index.ts";
import { renderGallery } from "./gallery.ts";
import { renderScene } from "./scene.ts";
import { routeOf, siteRoot, type Route } from "./site.ts";
import { injectStyle } from "./style.ts";

export function parseScenePlan(json: unknown): ScenePlan {
  return scenePlanSchema.parse(json);
}

function boot(root: URL): void {
  let view: AbortController | undefined;

  const show = (route: Route) => {
    view?.abort();
    const controller = new AbortController();
    view = controller;
    document.body.style.background = "";
    const shown = route.kind === "gallery"
      ? renderGallery(document.body, root, controller.signal)
      : renderScene(document.body, root, route.id, controller.signal);
    shown.catch((e) => console.error(e));
  };

  document.addEventListener("click", (e) => {
    const link = (e.target as Element | null)?.closest?.("a");
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || link.target) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || !url.pathname.startsWith(root.pathname)) return;
    e.preventDefault();
    if (url.href !== location.href) history.pushState(null, "", url);
    show(routeOf(url, root));
  });
  addEventListener("popstate", () => show(routeOf(new URL(location.href), root)));

  injectStyle();
  show(routeOf(new URL(location.href), root));
}

const script = document.currentScript as HTMLScriptElement | null;
if (script) boot(siteRoot(script.src));
