import { z } from "zod";
import { colour, colourList } from "./colours.ts";
import { generator } from "./kit.ts";
import { between, seeded } from "./raster.ts";

const count = (fallback: number) => z.coerce.number().int().min(0).default(fallback);
const positive = (fallback: number) => z.coerce.number().int().min(1).default(fallback);
const share = (fallback: number) => z.coerce.number().min(0).max(1).default(fallback);
const seed = z.coerce.number().int().default(1);

export const rect = generator({
  kind: "prop",
  params: z.strictObject({ fill: colour, border: colour.optional(), borderWidth: count(1) }),
  draw(r, p, { box, shades }) {
    r.rect(box.x, box.y, box.width, box.height, shades.rgb(p.fill));
    if (p.borderWidth > 0) r.border(box.x, box.y, box.width, box.height, p.borderWidth, shades.rgb(p.border ?? shades.dark(p.fill)));
  },
});

export const box = generator({
  kind: "prop",
  params: z.strictObject({ fill: colour, top: colour.optional(), outline: colour.optional(), topShare: share(0.2), drawers: count(0) }),
  draw(r, p, { box: b, shades }) {
    const seam = shades.rgb(shades.dark(p.fill));
    const outline = shades.rgb(p.outline ?? shades.dark(shades.dark(p.fill)));
    const topHeight = Math.max(1, Math.round(b.height * p.topShare));
    r.rect(b.x, b.y, b.width, b.height, shades.rgb(p.fill));
    r.rect(b.x, b.y, b.width, topHeight, shades.rgb(p.top ?? shades.warm(p.fill)));
    r.rect(b.x, b.y + topHeight, b.width, 1, seam);
    const front = b.height - topHeight - 1;
    for (let i = 1; i <= p.drawers; i++) {
      const top = b.y + topHeight + 1 + Math.round(((i - 1) * front) / p.drawers);
      if (i > 1) r.rect(b.x, top, b.width, 1, seam);
      const middle = top + Math.floor(front / p.drawers / 2);
      r.rect(b.x + Math.floor(b.width / 2) - 1, middle, 2, 1, outline);
    }
    r.border(b.x, b.y, b.width, b.height, 1, outline);
  },
});

export const shelf = generator({
  kind: "prop",
  params: z.strictObject({ frame: colour, back: colour.optional(), shelves: positive(3), thickness: positive(2), books: colourList.default([]), seed }),
  draw(r, p, { box: b, shades }) {
    const frame = shades.rgb(p.frame);
    const random = seeded(p.seed);
    r.rect(b.x, b.y, b.width, b.height, shades.rgb(p.back ?? shades.dark(p.frame)));
    r.border(b.x, b.y, b.width, b.height, p.thickness, frame);
    const inner = b.height - 2 * p.thickness;
    const bays = p.shelves + 1;
    for (let i = 0; i < bays; i++) {
      const top = b.y + p.thickness + Math.round((i * inner) / bays);
      const bottom = b.y + p.thickness + Math.round(((i + 1) * inner) / bays);
      if (i > 0) r.rect(b.x, top - p.thickness, b.width, p.thickness, frame);
      if (p.books.length === 0) continue;
      const room = bottom - top - (i < bays - 1 ? p.thickness : 0);
      for (let x = b.x + p.thickness; ; ) {
        const width = between(random, 2, 3);
        if (x + width > b.x + b.width - p.thickness) break;
        const height = Math.max(1, Math.round(room * (0.6 + random() * 0.35)));
        r.rect(x, top + room - height, width, height, shades.rgb(p.books[between(random, 0, p.books.length - 1)]));
        x += width + (random() < 0.25 ? 1 : 0);
      }
    }
    r.border(b.x, b.y, b.width, b.height, 1, shades.rgb(shades.dark(p.frame)));
  },
});

export const frame = generator({
  kind: "prop",
  params: z.strictObject({ colour, width: positive(3), inner: colour.optional(), mullionsAcross: count(0), mullionsDown: count(0) }),
  draw(r, p, { box: b, shades }) {
    const wood = shades.rgb(p.colour);
    const edge = shades.rgb(shades.dark(p.colour));
    if (p.inner !== undefined) r.rect(b.x, b.y, b.width, b.height, shades.rgb(p.inner));
    r.border(b.x, b.y, b.width, b.height, p.width, wood);
    const bar = Math.max(1, p.width - 1);
    const innerW = b.width - 2 * p.width, innerH = b.height - 2 * p.width;
    for (let i = 1; i <= p.mullionsAcross; i++) {
      r.rect(b.x + p.width + Math.round((i * innerW) / (p.mullionsAcross + 1)) - Math.floor(bar / 2), b.y, bar, b.height, wood);
    }
    for (let i = 1; i <= p.mullionsDown; i++) {
      r.rect(b.x, b.y + p.width + Math.round((i * innerH) / (p.mullionsDown + 1)) - Math.floor(bar / 2), b.width, bar, wood);
    }
    r.border(b.x, b.y, b.width, b.height, 1, edge);
    if (p.width > 1) r.border(b.x + p.width - 1, b.y + p.width - 1, innerW + 2, innerH + 2, 1, edge);
  },
});

export const skyline = generator({
  kind: "prop",
  params: z.strictObject({
    colour, edge: colour.optional(), windows: colourList.default([]), litShare: share(0.3),
    minWidth: positive(6), maxWidth: positive(16), minHeight: share(0.35), seed,
  }),
  draw(r, p, { box: b, shades }) {
    const random = seeded(p.seed);
    const body = shades.rgb(p.colour);
    const edge = shades.rgb(p.edge ?? shades.dark(p.colour));
    const blocks: { x: number; width: number; height: number }[] = [];
    for (let x = b.x; x < b.x + b.width; ) {
      const width = Math.min(between(random, p.minWidth, Math.max(p.minWidth, p.maxWidth)), b.x + b.width - x);
      blocks.push({ x, width, height: Math.max(3, Math.round(b.height * (p.minHeight + random() * (1 - p.minHeight)))) });
      x += width;
    }
    blocks[between(random, 0, blocks.length - 1)].height = b.height;
    for (const block of blocks) {
      const top = b.y + b.height - block.height;
      r.rect(block.x, top, block.width, block.height, body);
      r.rect(block.x, top, block.width, 1, edge);
      r.rect(block.x, top, 1, block.height, edge);
      if (p.windows.length === 0) continue;
      for (let y = top + 3; y < b.y + b.height - 2; y += 3) {
        for (let x = block.x + 2; x < block.x + block.width - 1; x += 2) {
          if (random() < p.litShare) r.set(x, y, shades.rgb(p.windows[between(random, 0, p.windows.length - 1)]));
        }
      }
    }
  },
});
