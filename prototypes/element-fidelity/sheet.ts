// PROTOTYPE. Builds out/index.html: raw vs processed per model, stats, cost, and the rough composites.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ELEMENTS } from "./elements.ts";
import { PALETTE } from "./palette.ts";
const stats: any[] = JSON.parse(readFileSync("out/stats.json", "utf8"));
const groups = new Map<string, any[]>();
for (const s of stats) { const k = `${s.model} @ ${s.tier}px tier`; groups.set(k, [...(groups.get(k) ?? []), s]); }
const esc = (s: string) => String(s).replace(/</g, "&lt;");
let html = `<!doctype html><meta charset="utf-8"><title>Element fidelity prototype</title>
<style>body{font:14px system-ui;background:#222;color:#ddd;margin:24px}h1,h2{font-weight:600}img{image-rendering:pixelated;background:#444;vertical-align:top}
table{border-collapse:collapse}td,th{padding:6px 8px;border-bottom:1px solid #444;text-align:left;vertical-align:top}.el{display:inline-block;margin:0 10px 10px 0;text-align:center}.el img{max-height:200px}
.sw{display:inline-block;width:22px;height:22px;margin-right:2px;border:1px solid #000}small{color:#999}.comp img{margin:0 12px 12px 0;max-width:100%}</style>
<h1>Element fidelity prototype (wayfinder #11)</h1>
<p>Palette: ${PALETTE.map((p) => `<span class="sw" style="background:${p}" title="${p}"></span>`).join("")} <small>(${PALETTE.length} colours)</small></p>
<p><small>Raw = PNG as the service returned it. Processed = binary alpha, nearest palette colour in Oklab, trimmed. Both shown at 6x nearest-neighbour.</small></p>
<h2>Composites (rough placement, same layout for every model)</h2><div class="comp">`;
for (const s of stats) { const f = `out/composite/${s.model}-${s.tier}@6x.png`; if (existsSync(f) && !html.includes(f)) html += `<div><b>${s.model} @ ${s.tier}</b><br><img src="${f.replace("out/", "")}"></div>`; }
html += `</div>`;
for (const [k, list] of groups) {
  const cost = list.reduce((a, s) => a + (s.cost_usd ?? 0), 0);
  const gens = list.reduce((a, s) => a + (s.usage?.generations ?? 0), 0);
  html += `<h2>${esc(k)} <small>${cost ? `$${cost.toFixed(2)} for ${list.length}` : gens ? `${gens} trial generations for ${list.length}` : ""}; avg ${Math.round(list.reduce((a, s) => a + s.ms, 0) / list.length / 1000)}s each</small></h2>`;
  for (const el of ELEMENTS) {
    const s = list.find((x) => x.element === el.id); if (!s) continue;
    if (!s.ok) { html += `<div class="el"><b>${el.id}</b><br><small>FAILED: ${esc(s.error)}</small></div>`; continue; }
    const b = `${s.model}-${s.element}-${s.tier}`;
    html += `<div class="el"><b>${el.id}</b><br><img src="preview/${b}-raw.png"> <img src="preview/${b}-processed.png"><br><small>${s.width}x${s.height} → ${s.trimmed}; ${s.coloursBefore} colours, ${s.inPalettePct}% on palette, mean Δ ${s.meanOklabDist} → ${s.coloursAfter} colours; soft alpha ${s.softAlpha}; white edge px ${s.whiteHaloPx}/${s.edgePx} ${s.note ? "; " + esc(s.note) : ""}</small></div>`;
  }
}
html += `<h2>All numbers</h2><table><tr><th>model</th><th>tier</th><th>element</th><th>size</th><th>cost</th><th>secs</th><th>colours</th><th>on palette</th><th>mean Δ</th><th>max Δ</th><th>after</th><th>soft α</th><th>white edge</th></tr>`;
for (const s of stats) html += `<tr><td>${s.model}</td><td>${s.tier}</td><td>${s.element}</td><td>${s.ok ? s.width + "x" + s.height : "-"}</td><td>${s.cost_usd ? "$" + s.cost_usd : s.usage?.generations ? s.usage.generations + " gen" : s.usage?.usd ? "$" + s.usage.usd : s.usage ? esc(JSON.stringify(s.usage)) : ""}</td><td>${Math.round(s.ms / 1000)}</td><td>${s.coloursBefore ?? ""}</td><td>${s.inPalettePct ?? ""}%</td><td>${s.meanOklabDist ?? ""}</td><td>${s.maxOklabDist ?? ""}</td><td>${s.coloursAfter ?? ""}</td><td>${s.softAlpha ?? ""}</td><td>${s.whiteHaloPx ?? ""}</td></tr>`;
html += `</table>`;
writeFileSync("out/index.html", html);
console.log("wrote out/index.html");
