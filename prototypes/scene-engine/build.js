// PROTOTYPE. Inlines assets/*.png into scene.template.html as data URIs so index.html is one double-clickable file.
import { readFileSync, writeFileSync } from "node:fs";
let html = readFileSync("scene.template.html", "utf8");
for (const n of ["lamp", "window", "skyline", "cat", "mug"]) html = html.replace(`{{${n}}}`, "data:image/png;base64," + readFileSync(`assets/${n}.png`).toString("base64"));
writeFileSync("index.html", html);
console.log("wrote index.html");
