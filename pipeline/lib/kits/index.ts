import type { Palette } from "../../../schema/index.ts";
import type { Pixels } from "../pixel-ops.ts";
import { shadesOf } from "./colours.ts";
import type { Box, Generator } from "./kit.ts";
import { Raster } from "./raster.ts";
import { box, frame, rect, shelf, skyline } from "./structural.ts";
import { boards, cloudBand, plaster, skyGradient, stars } from "./textures.ts";

export const generators: Readonly<Record<string, Generator>> = {
  rect, box, shelf, frame, skyline,
  "sky-gradient": skyGradient, stars, "cloud-band": cloudBand, boards, plaster,
};

export type ParamIssue = { path: string[]; message: string };

export function generatorOf(name: string): Generator {
  const g = generators[name];
  if (!g) throw new Error(`no generator ${name} in the local pixel engine; it has ${Object.keys(generators).join(", ")}`);
  return g;
}

function parseParams(name: string, params: unknown) {
  const parsed = generatorOf(name).params.safeParse(params);
  const issues: ParamIssue[] = parsed.success ? [] : parsed.error.issues.map((i) => ({ path: i.path.map(String), message: i.message }));
  return { issues, resolved: parsed.data as Record<string, unknown> };
}

export const paramIssues = (name: string, params: unknown): ParamIssue[] => parseParams(name, params).issues;

export type Drawn = { pixels: Pixels; params: Record<string, unknown> };

// A prop is drawn into its target box, bottom-centred on the canvas, so its trimmed box matches its real size; a texture fills the canvas.
export function drawLocal(name: string, params: unknown, opts: { canvas: { width: number; height: number }; target?: { width: number; height: number }; palette: Palette }): Drawn {
  const g = generatorOf(name);
  const { issues, resolved } = parseParams(name, params);
  if (issues.length > 0) throw new Error(`generator ${name}: ${issues.map((i) => `params.${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const { canvas } = opts;
  const width = g.kind === "prop" && opts.target ? Math.min(canvas.width, Math.max(1, Math.round(opts.target.width))) : canvas.width;
  const height = g.kind === "prop" && opts.target ? Math.min(canvas.height, Math.max(1, Math.round(opts.target.height))) : canvas.height;
  const target: Box = { x: Math.floor((canvas.width - width) / 2), y: canvas.height - height, width, height };
  const raster = new Raster(canvas.width, canvas.height);
  g.draw(raster, resolved, { box: target, shades: shadesOf(opts.palette) });
  return { pixels: raster.pixels(), params: resolved };
}
