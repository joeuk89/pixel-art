// PROTOTYPE helper: prints colour count and alpha stats for raw PNGs, and tiles them at 6x into one sheet.
import sharp from "sharp";
const files = process.argv.slice(2);
const tiles: Buffer[] = [];
for (const f of files) {
  const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colours = new Set<number>(); let soft = 0, transparent = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) { transparent++; continue; }
    if (a !== 255) soft++;
    colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  }
  console.log(`${f}: ${info.width}x${info.height} colours=${colours.size} transparent=${(100*transparent/(info.width*info.height)).toFixed(0)}% softAlpha=${soft}`);
  tiles.push(await sharp(f).ensureAlpha().resize({ width: 256, height: 256, fit: "contain", kernel: "nearest", background: { r: 60, g: 60, b: 60, alpha: 1 } }).flatten({ background: "#3c3c3c" }).png().toBuffer());
}
const n = tiles.length, cols = Math.min(n, 6), rows = Math.ceil(n / cols);
await sharp({ create: { width: cols * 260, height: rows * 260, channels: 4, background: "#3c3c3c" } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * 260 + 2, top: Math.floor(i / cols) * 260 + 2 })))
  .png().toFile("out/inspect.png");
