# Prop scale prototype (wayfinder #28)

PROTOTYPE, throwaway. Under a 64 px Style anchor, do props from 16 to 128 px hold the house style? Are custom 4 px-step sizes as clean as PixelLab's native ones? Do the Quality gate thresholds survive per canvas size, and does animate v3 give a clean 4-frame strip on a small prop?

- `node generate.ts [condition] [element]` generates every prop under every condition into `out/raw`, then the cat strips (skips what exists). `node generate.ts strips` runs only the strips.
- `node process.ts` gates each PNG, measures style traits against the anchor, composites the Scene at 192x120 and writes `out/index.html`.
- Needs `PIXELLAB_API_KEY` in the repo `.env`.

The anchor (`out/raw/anchor-window.png`) and skyline are copied from `prototypes/style-lock` (base-s1). Sizes and conditions are in `elements.ts`. Findings and the decision are on the ticket.
