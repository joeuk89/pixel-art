import type { z } from "zod";
import type { Shades } from "./colours.ts";
import type { Raster } from "./raster.ts";

export type Box = { x: number; y: number; width: number; height: number };
export type DrawContext = { box: Box; shades: Shades };

export type Generator<S extends z.ZodType = z.ZodType> = {
  kind: "prop" | "texture";
  params: S;
  draw: (raster: Raster, params: z.output<S>, ctx: DrawContext) => void;
};

export const generator = <S extends z.ZodType>(g: Generator<S>): Generator => g as unknown as Generator;
