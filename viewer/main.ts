import { scenePlanSchema, type ScenePlan } from "../schema/index.ts";

export function parseScenePlan(json: unknown): ScenePlan {
  return scenePlanSchema.parse(json);
}
