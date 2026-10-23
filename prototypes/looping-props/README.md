# Looping props prototype (wayfinder #19)

PROTOTYPE, throwaway. How should a simple looping prop (a blinking sign, a swaying plant, a cat's twitching tail, steam from a mug) get its frames?

Compared on four props, all from one Pro Flash static Element on the house palette:

- **Code-driven** in the Viewer from the single static: palette blink, row shear, breath plus tail nudge, engine steam. $0.
- **Retro Diffusion** `rd_advanced_animation__subtle_motion`, 8 frames, $0.25 per prop.
- **PixelLab** `animate-with-text-v3`, 4 and 8 frames, subscription generations.
- **PixelLab** `edit-images-v2`, two hand-briefed variants played ping-pong with the static.

Run from this folder with the API keys in the repo-root `.env`:

```
npm install
npm run all      # generate (skips what exists), measure, build index.html
npm start        # rebuild and open the comparison page
```

`generate.ts [statics|rd8|rd12|pl4|pl8|edits|all] [prop]` records every call in `out/manifest.json`. `process.ts` decodes each result into 64x64 frames, writes vertical strips (raw and snapped to the palette) to `out/strips/` and the measurements to `out/stats.json`. `index.html` is self-contained: props by rows, methods by columns, shared fps control, palette-snap and loop-seam toggles.
