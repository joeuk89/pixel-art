import { z } from "zod";
import type { Palette } from "../../../schema/index.ts";
import { rgbOf } from "../pixel-ops.ts";
import type { Rgb } from "./raster.ts";

export type Colour = number | string;

const one = z.union([z.number().int().min(0), z.string().regex(/^#[0-9a-f]{6}$/, "must be a Palette index or a lowercase #rrggbb colour")]);
const fromText = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v);

export const colour = z.preprocess(fromText, one);
export const colourList = z.preprocess(
  (v) => (typeof v === "string" ? (v === "" ? [] : v.split(",")) : v),
  z.array(colour),
);

// A hex colour off the Palette has no Ramp, so shading leaves it as given and the Quality gate's Palette check catches it.
export type Shades = { rgb: (c: Colour) => Rgb; dark: (c: Colour) => Colour; warm: (c: Colour) => Colour };

export function shadesOf(palette: Palette): Shades {
  const index = (c: Colour) => {
    if (typeof c === "string") return palette.colours.indexOf(c);
    if (c >= palette.colours.length) throw new Error(`colour index ${c} is not in Palette ${palette.name} (${palette.colours.length} colours)`);
    return c;
  };
  const step = (which: "dark" | "warm") => (c: Colour): Colour => {
    const i = index(c);
    if (i < 0) return c;
    if (!palette.ramps) throw new Error(`Palette ${palette.name} has no Ramp table to shade colour ${c} with; name the colour or use a v2 Palette`);
    return palette.ramps[i][which];
  };
  return {
    rgb: (c) => (typeof c === "string" ? rgbOf(c) : rgbOf(palette.colours[index(c)])),
    dark: step("dark"),
    warm: step("warm"),
  };
}
