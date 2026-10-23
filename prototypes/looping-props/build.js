// PROTOTYPE. Inlines out/strips/*.png and out/stats.json into index.template.html so index.html is one double-clickable file.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PROPS, PALETTE } from "./props.ts";
const stats = JSON.parse(readFileSync("out/stats.json", "utf8"));
const strips = {};
for (const s of stats) {
  if (s.error) continue;
  const key = `${s.prop}-${s.method}`;
  strips[key] = "data:image/png;base64," + readFileSync(`out/strips/${key}.png`).toString("base64");
  if (existsSync(`out/strips/${key}-snapped.png`)) strips[key + "-snapped"] = "data:image/png;base64," + readFileSync(`out/strips/${key}-snapped.png`).toString("base64");
}
const html = readFileSync("index.template.html", "utf8").replace("{{DATA}}", JSON.stringify({ props: PROPS, palette: PALETTE, stats, strips }));
writeFileSync("index.html", html);
console.log("wrote index.html", (html.length / 1024).toFixed(0) + "KB");
