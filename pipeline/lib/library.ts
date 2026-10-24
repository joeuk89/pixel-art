import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import {
  ambientLoopRecordSchema,
  elementRecordSchema,
  scenePlanSchema,
  type AmbientLoopRecord,
  type ElementRecord,
  type ScenePlan,
} from "../../schema/index.ts";

export const ELEMENTS = "library/elements";
export const AMBIENT = "library/ambient";
export const SCENES = "scenes";

export function readRecord<S extends z.ZodType>(file: string, schema: S): z.infer<S> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${file}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  return parsed.data;
}

function readDir<S extends z.ZodType>(dir: string, schema: S): z.infer<S>[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => readRecord(join(dir, n), schema));
}

export function readElements(root = process.cwd()): ElementRecord[] {
  return readDir(join(root, ELEMENTS), elementRecordSchema);
}

export function readSounds(root = process.cwd()): AmbientLoopRecord[] {
  return readDir(join(root, AMBIENT), ambientLoopRecordSchema);
}

export type SceneFile = { file: string; plan: ScenePlan };

export function sceneFiles(root = process.cwd()): string[] {
  const dir = join(root, SCENES);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "scene.json")))
    .map((d) => `${SCENES}/${d.name}/scene.json`)
    .sort();
}

export function readScene(file: string): ScenePlan {
  return readRecord(file, scenePlanSchema);
}

export function readScenes(root = process.cwd()): SceneFile[] {
  return sceneFiles(root).map((file) => ({ file, plan: readScene(join(root, file)) }));
}
