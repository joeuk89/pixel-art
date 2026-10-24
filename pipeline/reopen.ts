import { readFileSync, writeFileSync } from "node:fs";
import { isPixelLabFrames, scenePlanSchema, type ElementRecord } from "../schema/index.ts";
import { main } from "./lib/cli.ts";
import { readElements, readScene } from "./lib/library.ts";

function generateFrom(record: ElementRecord) {
  if (record.kind === "backdrop") return { kind: "backdrop", brief: record.brief, tags: record.tags };
  const animation = record.animation;
  const keepFrames = animation && (animation.service !== "pixellab" || isPixelLabFrames(animation.frames));
  const strip = animation ? { service: animation.service, ...(keepFrames ? { frames: animation.frames } : {}) } : undefined;
  return { kind: "prop", brief: record.brief, realSize: record.realSize, tags: record.tags, ...(strip ? { strip } : {}) };
}

// A fresh proposed id keeps the new Attempts and their budget apart from the Element being replaced.
function nextId(id: string, taken: Set<string>): string {
  const m = id.match(/^(.*)-(\d+)$/)!;
  let n = Number(m[2]);
  let next = id;
  while (taken.has(next)) next = `${m[1]}-${String(++n).padStart(m[2].length, "0")}`;
  return next;
}

main(() => {
  const [file, ...ids] = process.argv.slice(2);
  if (!file || ids.length === 0) throw new Error("usage: reopen <scene.json> <placementId...>");
  const plan = readScene(file);
  const records = new Map(readElements().map((e) => [e.id, e]));
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const placements = raw.layers.flatMap((l: any) => l.placements ?? []);
  for (const id of ids) {
    const target = placements.find((p: any) => p.id === id);
    if (!target) throw new Error(`no Placement ${id} in Scene ${plan.id}`);
    if (target.generate) throw new Error(`Placement ${id} already has a generate block`);
    const record = records.get(target.element);
    if (!record) throw new Error(`Element ${target.element} is not in the Element library`);
    target.generate = generateFrom(record);
    target.element = nextId(record.id, new Set(records.keys()));
  }
  raw.status = "draft";
  scenePlanSchema.parse(raw);
  writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
  const proposed = Object.fromEntries(ids.map((id) => [id, placements.find((p: any) => p.id === id).element]));
  return { scene: plan.id, reopened: ids, proposed, plan: file };
});
