// PROTOTYPE, throwaway. Static server so the page can fetch the audio files. Run: npm start
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
const types: Record<string, string> = { ".html": "text/html", ".json": "application/json", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".opus": "audio/ogg", ".ogg": "audio/ogg" };
createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = "." + (path === "/" ? "/index.html" : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(8765, () => console.log("http://localhost:8765/  (Ctrl+C to stop)"));
