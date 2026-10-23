# Style lock prototype (wayfinder #22)

PROTOTYPE, throwaway. Does Pro Flash hold one style across ten varied Elements and two seeds, and does passing the first Element as `style_image` tighten it?

- `node generate.ts [condition] [element]` generates every Element under every condition into `out/raw` (skips what exists).
- `node process.ts` checks each PNG, measures style traits, builds lineups, composites and `out/index.html`.
- Needs `PIXELLAB_API_KEY` in the repo `.env`.

Conditions are in `elements.ts`. Findings and the decision are on the ticket.
