# Music loop prototype (wayfinder #13)

PROTOTYPE, throwaway. Can a generated ambient track loop seamlessly under a curated rain loop in the browser for twenty minutes?

Run: `npm start` (serves this folder on http://localhost:8765/ and opens it). Click the green button (autoplay gate), pick a loop, listen.

- `generate.ts`: one brief (rain-on-window piano) to Stable Audio 3.0 (135 s WAV, `duration` honoured, 10 s) and Lyria 3.5 (asked for 2:15, got 2:13, 48 kHz WAV, 24 s). About $0.08 each.
- `loop.ts`: Method A. Trims 8 s off each end, searches for a 105 to 115 s region whose start envelope matches its end, crossfades the tail into the head (equal power, 2, 4 or 8 s), writes WAV, encodes MP3 192k and Opus 96k with ffmpeg-static, records loop points in `out/manifest.json`.
- `inpaint.ts`: Method B. Rotates the Stable Audio region so the seam sits mid-file, asks Stable Audio `inpaint` to recompose 12 s around it, rotates back. The API returned the 190 s default length on the first run; the result was trimmed to the loop length by hand.
- `rain.ts`: fetches the HQ OGG previews of two CC0 Freesound rain loops (originals need OAuth2).
- `index.html`: Web Audio mixer. Music and rain on separate gains, `AudioBufferSourceNode` loops with loop points from the manifest, seam flash and wrap counter, 20-minute timer, visibility log, optional suspend-while-hidden, optional `<audio loop>` element for comparison.

WAVs are gitignored (about 20 MB each); MP3, Opus and OGG are committed so the page runs from a checkout.
