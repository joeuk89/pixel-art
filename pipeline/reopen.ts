import { parseArgs } from "node:util";
import { isPixelLabFrames, type ElementRecord } from "../schema/index.ts";
import { forgetAbandoned } from "./lib/attempts.ts";
import { main } from "./lib/cli.ts";
import { readElements, readScene } from "./lib/library.ts";
import { editPlan } from "./lib/plan-file.ts";

type Size = { w: number; h: number };

function generateFrom(record: ElementRecord, size?: Size, upgrade = false) {
  if (record.kind === "backdrop") return { kind: "backdrop", brief: record.brief, tags: record.tags, size: size ?? { w: record.width, h: record.height } };
  if (size) throw new Error(`Element ${record.id} is a ${record.kind}; --size applies only to a Backdrop`);
  if (record.kind === "texture") throw new Error(`Element ${record.id} is a Seamless texture, which reopen does not regenerate`);
  const animation = record.animation;
  const keepFrames = animation && (animation.service !== "pixellab" || isPixelLabFrames(animation.frames));
  const strip = animation ? { service: animation.service, ...(keepFrames ? { frames: animation.frames } : {}) } : undefined;
  if (upgrade && record.service !== "local") throw new Error(`Element ${record.id} is not a local Finish, so it has nothing to upgrade`);
  const finish = record.service === "local" && !upgrade ? { finish: "local", generator: record.generator, params: record.params } : {};
  return { kind: "prop", brief: record.brief, realSize: record.realSize, tags: record.tags, ...(strip ? { strip } : {}), ...finish };
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
  const { values, positionals } = parseArgs({
    options: { size: { type: "string", multiple: true, default: [] }, upgrade: { type: "string", multiple: true, default: [] } },
    allowPositionals: true,
  });
  const [file, ...named] = positionals;
  const ids = [...new Set([...named, ...values.upgrade])];
  if (!file || ids.length === 0) throw new Error("usage: reopen <scene.json> <placementId...> [--size <placementId>=<w>x<h>]... [--upgrade <placementId>]...");
  const sizes = new Map<string, Size>(values.size.map((pair) => {
    const m = pair.match(/^([a-z0-9-]+)=(\d+)x(\d+)$/);
    if (!m) throw new Error(`--size takes <placementId>=<w>x<h>, got ${pair}`);
    if (!ids.includes(m[1])) throw new Error(`--size names ${m[1]}, which is not being reopened`);
    return [m[1], { w: Number(m[2]), h: Number(m[3]) }];
  }));
  const plan = readScene(file);
  const records = new Map(readElements().map((e) => [e.id, e]));
  const proposed = editPlan(file, (raw) => {
    const placements = raw.layers.flatMap((l: any) => l.placements ?? []);
    for (const id of ids) {
      const target = placements.find((p: any) => p.id === id);
      if (!target) throw new Error(`no Placement ${id} in Scene ${plan.id}`);
      if (target.generate) throw new Error(`Placement ${id} already has a generate block`);
      const record = records.get(target.element);
      if (!record) throw new Error(`Element ${target.element} is not in the Element library`);
      target.generate = generateFrom(record, sizes.get(id), values.upgrade.includes(id));
      target.element = nextId(record.id, new Set(records.keys()));
    }
    raw.status = "draft";
    return Object.fromEntries(ids.map((id) => [id, placements.find((p: any) => p.id === id).element as string]));
  });
  forgetAbandoned(plan.id, ids);
  return { scene: plan.id, reopened: ids, ...(values.upgrade.length > 0 ? { upgraded: values.upgrade } : {}), proposed, plan: file };
});
