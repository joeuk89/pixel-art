# Penthouse depth prototype (wayfinder ticket 66)

PROTOTYPE, throwaway, never merged. What does the penthouse look like staged as a space you are inside: floor, sides, near, mid and far planes?

Run: `npm start` (inlines the library Elements and `out/raw/*.png` into `index.html` and opens it). ← → switch stagings; A atmospheric ramps, D drift (off, pixel, smooth), P plane tint, N notes.

- `index.template.html`: all stagings, the room-box geometry, ramp remapping and the depth-correct drift compositor.
- `export-inputs.mjs`: renders the plain geometry used as Bitforge init images into `out/in`.
- `generate.ts`: the PixelLab calls (Bitforge shells styled on the v1 Poster, a Pro Flash armchair). 20 generations in total.

Verdict and findings: see the resolution comment on issue 66.
