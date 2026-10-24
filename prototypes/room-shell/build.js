// PROTOTYPE. Inlines the v1 library Elements, out/raw and out/ref into index.template.html so index.html is one double-clickable file.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
const lib = "../../library/elements/";
const names = ["sky-storm-clouds-night-01", "city-skyline-river-night-02", "window-mullion-steel-01", "lamp-floor-linen-drum-01", "armchair-back-wool-throw-01", "table-side-tumbler-whisky-01"];
const png = (f) => "data:image/png;base64," + readFileSync(f).toString("base64");
const assets = Object.fromEntries(names.map((n) => [n, png(lib + n + ".png")]));
for (const dir of ["out/raw", "out/ref"]) if (existsSync(dir)) for (const f of readdirSync(dir).filter((f) => f.endsWith(".png"))) assets["gen:" + f.slice(0, -4)] = png(`${dir}/${f}`);
const palette = JSON.parse(readFileSync("../../library/palettes/cosy-night.json", "utf8")).colours;
const html = readFileSync("index.template.html", "utf8").replace("/*ASSETS*/{}", JSON.stringify(assets)).replace("/*PALETTE*/[]", JSON.stringify(palette));
writeFileSync("index.html", html);
console.log(`wrote index.html (${Object.keys(assets).filter((k) => k.startsWith("gen:")).length} generated images)`);
