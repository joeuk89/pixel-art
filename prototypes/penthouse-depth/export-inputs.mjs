// PROTOTYPE. Renders the generation inputs (plain shell geometry, near wall, palette strip) from index.html into out/in.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(`file://${process.cwd()}/index.html?notes=0`); await p.waitForTimeout(500);
const out = await p.evaluate(() => {
  const mk = (w, h, f) => { const c = Object.assign(document.createElement("canvas"), { width: w, height: h }); const x = c.getContext("2d"); f(x); return c.toDataURL().split(",")[1]; };
  return {
    "shell-A": mk(192, 120, (x) => { rect(x, 0, 0, 192, 120, 0); roomBox(x, { x0: 22, y0: 10, x1: 158, y1: 90 }, [84, 52], { plain: true }); rect(x, 22, 10, 136, 4, 1); rect(x, 22, 85, 136, 5, 1); rect(x, 22, 14, 6, 71, 1); rect(x, 152, 14, 6, 71, 1); rect(x, 28, 14, 124, 71, 0); }),
    "near-C": mk(192, 120, (x) => { rect(x, 0, 0, 192, 120, 0); VARIANTS[3].planes[2].draw(x); }),
    "palette": mk(16, 1, (x) => PAL.forEach((h, i) => rect(x, i, 0, 1, 1, i))),
  };
});
for (const [k, v] of Object.entries(out)) writeFileSync(`out/in/${k}.png`, Buffer.from(v, "base64"));
console.log(Object.keys(out).join(" ")); await b.close();
