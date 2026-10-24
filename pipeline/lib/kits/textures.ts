import { z } from "zod";
import { colour, colourList } from "./colours.ts";
import { generator, seed } from "./kit.ts";
import { between, seeded } from "./raster.ts";

// The wrap-seam check compares the first and last columns, so every texture keeps those two columns equal.
const innerColumn = (random: () => number, width: number, span = 1) => between(random, 1, width - 2 - span);

export const skyGradient = generator({
  kind: "texture",
  params: z.strictObject({ colours: colourList.refine((c) => c.length >= 2, "a sky gradient needs at least two colours") }),
  draw(r, p, { box, shades }) {
    const bands = p.colours;
    bands.forEach((c, i) => {
      const top = Math.round((i * box.height) / bands.length);
      const bottom = Math.round(((i + 1) * box.height) / bands.length);
      r.rect(0, top, box.width, bottom - top, shades.rgb(c));
    });
  },
});

export const stars = generator({
  kind: "texture",
  params: z.strictObject({ sky: colour, stars: colourList.refine((c) => c.length >= 1, "name at least one star colour"), count: z.coerce.number().int().min(0).optional(), seed }),
  draw(r, p, { box, shades }) {
    const random = seeded(p.seed);
    const colours = p.stars;
    r.rect(0, 0, box.width, box.height, shades.rgb(p.sky));
    const n = p.count ?? Math.round((box.width * box.height) / 150);
    for (let i = 0; i < n; i++) {
      r.set(innerColumn(random, box.width), between(random, 0, box.height - 1), shades.rgb(colours[between(random, 0, colours.length - 1)]));
    }
  },
});

export const cloudBand = generator({
  kind: "texture",
  params: z.strictObject({
    cloud: colour, shade: colour.optional(), sky: colour.optional(),
    y: z.coerce.number().int().min(0).optional(), thickness: z.coerce.number().int().min(2).optional(), seed,
  }),
  draw(r, p, { box, shades }) {
    const random = seeded(p.seed);
    const centre = p.y ?? Math.round(box.height / 2);
    const thickness = p.thickness ?? Math.max(2, Math.round(box.height / 3));
    const phases = [0, 1, 2].map(() => random() * 2 * Math.PI);
    const period = box.width - 1;
    const wave = (x: number, shift: number) =>
      phases.reduce((sum, phase, k) => sum + Math.sin((2 * Math.PI * (k + 1) * (x % period)) / period + phase + shift) / (k + 1), 0) / 1.8;
    if (p.sky !== undefined) r.rect(0, 0, box.width, box.height, shades.rgb(p.sky));
    const cloud = shades.rgb(p.cloud);
    const shade = shades.rgb(p.shade ?? shades.dark(p.cloud));
    for (let x = 0; x < box.width; x++) {
      const top = Math.round(centre - thickness / 2 - (wave(x, 0) * thickness) / 2);
      const bottom = Math.round(centre + thickness / 2 + (wave(x, 1.3) * thickness) / 4);
      for (let y = Math.max(0, top); y <= Math.min(box.height - 1, bottom); y++) r.set(x, y, y >= bottom - 1 ? shade : cloud);
    }
  },
});

export const boards = generator({
  kind: "texture",
  params: z.strictObject({
    fill: colour, seam: colour.optional(), light: colour.optional(),
    boardHeight: z.coerce.number().int().min(2).default(6), joints: z.coerce.number().int().min(0).default(1), seed,
  }),
  draw(r, p, { box, shades }) {
    const random = seeded(p.seed);
    const seam = shades.rgb(p.seam ?? shades.dark(p.fill));
    const light = shades.rgb(p.light ?? shades.warm(p.fill));
    r.rect(0, 0, box.width, box.height, shades.rgb(p.fill));
    for (let top = 0; top < box.height; top += p.boardHeight) {
      r.rect(0, top, box.width, 1, seam);
      r.rect(0, top + 1, box.width, 1, light);
      for (let j = 0; j < p.joints; j++) r.rect(innerColumn(random, box.width), top + 1, 1, p.boardHeight - 1, seam);
    }
  },
});

export const plaster = generator({
  kind: "texture",
  params: z.strictObject({ fill: colour, grain: colour.optional(), density: z.coerce.number().min(0).max(0.2).default(0.02), seed }),
  draw(r, p, { box, shades }) {
    const random = seeded(p.seed);
    r.rect(0, 0, box.width, box.height, shades.rgb(p.fill));
    const grain = shades.rgb(p.grain ?? shades.dark(p.fill));
    const specks = Math.round((box.width * box.height * p.density) / 2);
    for (let i = 0; i < specks; i++) r.rect(innerColumn(random, box.width, 2), between(random, 0, box.height - 1), 2, 1, grain);
  },
});
