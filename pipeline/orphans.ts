import { allPlacements, sceneSounds } from "../schema/index.ts";
import { main } from "./lib/cli.ts";
import { readElements, readScenes, readSounds } from "./lib/library.ts";

main(() => {
  if (process.argv.length > 2) throw new Error("usage: orphans");
  const usedElements = new Set<string>();
  const usedSounds = new Set<string>();
  for (const { plan } of readScenes()) {
    if (plan.styleAnchor) usedElements.add(plan.styleAnchor);
    for (const p of allPlacements(plan)) usedElements.add(p.element);
    for (const { entry: { source } } of sceneSounds(plan)) {
      if (source.id !== undefined) usedSounds.add(source.id);
    }
  }
  const brief = ({ id, kind, subject }: { id: string; kind: string; subject: string }) => ({ id, kind, subject });
  return {
    elements: readElements().filter((e) => !usedElements.has(e.id)).map(brief),
    ambient: readSounds().filter((s) => !usedSounds.has(s.id)).map(brief),
  };
});
