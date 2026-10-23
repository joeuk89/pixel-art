// PROTOTYPE, throwaway. Fetches the HQ OGG previews of two CC0 Freesound rain loops
// (originals need OAuth2; previews are fine for a listening test). Run: npm run rain
import { writeFileSync } from "node:fs";
const key = process.env.FREESOUND_API_KEY!;
const sounds = { "rain-indoors-242889": 242889, "rain-soft-595717": 595717 };
for (const [name, id] of Object.entries(sounds)) {
  const r = await fetch(`https://freesound.org/apiv2/sounds/${id}/?fields=name,duration,license,previews,filesize,type&token=${key}`);
  if (!r.ok) throw new Error(`freesound ${id}: HTTP ${r.status}`);
  const j = (await r.json()) as { name: string; duration: number; license: string; type: string; filesize: number; previews: Record<string, string> };
  const a = await fetch(j.previews["preview-hq-ogg"]);
  const bytes = new Uint8Array(await a.arrayBuffer());
  writeFileSync(`out/${name}.ogg`, bytes);
  console.log(`${name}: "${j.name}" ${j.duration}s ${j.type} ${j.filesize} B, ${j.license}; preview ${bytes.length} B -> out/${name}.ogg`);
}
