export type Route = { kind: "gallery" } | { kind: "scene"; id: string };

export function siteRoot(scriptUrl: string): URL {
  return new URL(".", scriptUrl);
}

export function routeOf(url: URL, root: URL): Route {
  const path = url.pathname.startsWith(root.pathname) ? url.pathname.slice(root.pathname.length) : "";
  const scene = path.match(/^scenes\/([^/]+)\/?(?:index\.html)?$/);
  return scene ? { kind: "scene", id: decodeURIComponent(scene[1]) } : { kind: "gallery" };
}

export function sceneUrl(root: URL, id: string): URL {
  return new URL(`scenes/${encodeURIComponent(id)}/`, root);
}
