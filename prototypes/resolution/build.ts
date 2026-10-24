// PROTOTYPE. Snaps every image to cosy-night, runs the pipeline's Quality gate plus an orphan-pixel count on it,
// and inlines the images and the gate report into index.template.html, so index.html is one double-clickable file.
// Run from this folder: node build.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { gateStill } from "../../pipeline/lib/quality-gate.ts";
import { snapToPalette } from "../../pipeline/lib/strip.ts";

const palette: string[] = JSON.parse(readFileSync("../../library/palettes/cosy-night.json", "utf8")).colours;
const lib = (n: string) => `../../library/elements/${n}.png`;
const sources: Record<string, string> = {
  "v1-poster": "../../scenes/penthouse-rain-city-night-1x66/poster.png",
  "v1-armchair": lib("armchair-back-wool-throw-01"), "v1-lamp": lib("lamp-floor-linen-drum-01"), "v1-table": lib("table-side-tumbler-whisky-01"),
  "v1-sky": lib("sky-storm-clouds-night-01"), "v1-city": lib("city-skyline-river-night-02"),
};
// The 192x120 Features come from the room-shell prototype (Pro Flash on cosy-night, same briefs).
for (const f of ["painting-flat", "sconce", "rug-flat"]) if (existsSync(`room-shell/${f}.png`)) sources[`rs-${f}`] = `room-shell/${f}.png`;
if (existsSync("out/raw")) for (const f of readdirSync("out/raw").filter((f) => f.endsWith(".png"))) sources[f.slice(0, -4)] = `out/raw/${f}`;

// Orphans: opaque pixels whose four neighbours all differ from them; the research's stray-pixel measure.
function orphans(px: { width: number; height: number; data: Uint8Array }): number {
  const { width: w, height: h, data: d } = px;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h || d[(y * w + x) * 4 + 3] === 0 ? -1 : (d[(y * w + x) * 4] << 16) | (d[(y * w + x) * 4 + 1] << 8) | d[(y * w + x) * 4 + 2]);
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = at(x, y);
    if (c >= 0 && at(x - 1, y) !== c && at(x + 1, y) !== c && at(x, y - 1) !== c && at(x, y + 1) !== c) n++;
  }
  return n;
}

const assets: Record<string, string> = {};
const gate: Record<string, unknown> = {};
for (const [key, file] of Object.entries(sources)) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const raw = { width: info.width, height: info.height, data: new Uint8Array(data) };
  for (let i = 3; i < raw.data.length; i += 4) raw.data[i] = raw.data[i] < 128 ? 0 : 255;
  const before = gateStill(raw, { kind: "backdrop", canvas: { width: info.width, height: info.height }, palette });
  const { frame } = snapToPalette(raw, palette);
  gate[key] = { size: `${info.width}x${info.height}`, offPaletteBefore: before.measurements.offPalettePixels, trimmed: before.measurements.trimmed, islands: before.measurements.islands, orphans: orphans(frame), opaque: info.width * info.height - before.measurements.transparentPixels };
  const png = await sharp(Buffer.from(frame.data), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  assets[key] = "data:image/png;base64," + png.toString("base64");
}
const ledger = existsSync("out/ledger.json") ? readFileSync("out/ledger.json", "utf8") : "{}";
const html = readFileSync("index.template.html", "utf8")
  .replace("/*ASSETS*/{}", JSON.stringify(assets)).replace("/*PALETTE*/[]", JSON.stringify(palette))
  .replace("/*GATE*/{}", JSON.stringify(gate)).replace("/*LEDGER*/{}", ledger);
writeFileSync("index.html", html);
writeFileSync("out/gate.json", JSON.stringify(gate, null, 2) + "\n");
console.log(`wrote index.html with ${Object.keys(assets).length} images`);
