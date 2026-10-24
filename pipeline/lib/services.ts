export type ServiceName = "freesound" | "pixellab" | "retro-diffusion" | "stability" | "fal" | "gemini";

const VARIABLES: Record<ServiceName, { base: string; key: string }> = {
  freesound: { base: "FREESOUND_BASE_URL", key: "FREESOUND_API_KEY" },
  pixellab: { base: "PIXELLAB_BASE_URL", key: "PIXELLAB_API_KEY" },
  "retro-diffusion": { base: "RETRO_DIFFUSION_BASE_URL", key: "RETRO_DIFFUSION_API_KEY" },
  stability: { base: "STABILITY_BASE_URL", key: "STABILITY_API_KEY" },
  fal: { base: "FAL_BASE_URL", key: "FAL_KEY" },
  gemini: { base: "GEMINI_BASE_URL", key: "GEMINI_API_KEY" },
};

export type Service = { name: ServiceName; baseUrl: string; key: string; keyVariable: string };

export class MissingEnvError extends Error {}

export function service(name: ServiceName): Service {
  const { base, key } = VARIABLES[name];
  const missing = [base, key].filter((v) => !process.env[v]);
  if (missing.length) throw new MissingEnvError(`${missing.join(" and ")} not set; copy the names from .env.example into .env`);
  return { name, baseUrl: process.env[base]!.replace(/\/+$/, ""), key: process.env[key]!, keyVariable: key };
}

export const serviceNames = Object.keys(VARIABLES) as ServiceName[];
export const keyVariable = (name: ServiceName) => VARIABLES[name].key;
