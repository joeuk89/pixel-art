// PROTOTYPE. Inlines the v1 library Elements into index.template.html so index.html is one double-clickable file.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
const lib = "../../library/elements/";
const names = [
  "sky-storm-clouds-night-01", "city-skyline-river-night-01", "city-skyline-river-night-02",
  "window-mullion-steel-01", "lamp-floor-linen-drum-01", "armchair-back-wool-throw-01", "table-side-tumbler-whisky-01",
];
const assets = Object.fromEntries(names.map((n) => [n, "data:image/png;base64," + readFileSync(lib + n + ".png").toString("base64")]));
if (existsSync("out/raw")) for (const f of readdirSync("out/raw").filter((f) => f.endsWith(".png"))) assets["gen:" + f.slice(0, -4)] = "data:image/png;base64," + readFileSync("out/raw/" + f).toString("base64");
const palette = JSON.parse(readFileSync("../../library/palettes/cosy-night.json", "utf8")).colours;
let html = readFileSync("index.template.html", "utf8");
html = html.replace("/*ASSETS*/{}", JSON.stringify(assets)).replace("/*PALETTE*/[]", JSON.stringify(palette));
writeFileSync("index.html", html);
console.log("wrote index.html");
