# Resolution prototype (wayfinder ticket 71)

PROTOTYPE, throwaway, never merged. Is 384x240 the right v2 resolution? The penthouse rebuilt under the v2 depth and Backdrop rules, judged fullscreen beside the 192x120 original.

Run: `npm start` (snaps the images to cosy-night, runs the Quality gate, inlines everything into `index.html` and opens it). Keys: 1 v1 Poster, 2 v2 at 192x120, 3 v2 at 384x240, 4 the two v2 renders side by side, 5 v1 beside v2 at 384; B Backdrop service, T shell texture, L lighting, P panel, F fullscreen.

- `index.template.html`: the room shell drawn in perspective, the Opening frame, Features projected from their own pixels, floor props on their foot, rain, ramp lighting with a lamp Halo. Geometry, lights and rain are written in 192x120 units and multiplied by S, so the two v2 renders differ only in resolution and Elements.
- `generate.ts`: the paid calls. Props sized by the Scale at their foot (back-wall Scale 26.4 px/m at 192x120, 52.9 at 384x240, for a 2.8 m ceiling); Features at the Scale of their nearest edge; the Backdrop at the window Opening's size on Pro Flash, Pro, Pixflux and RD Plus.
- `build.ts`: Palette snap, the pipeline's `gateStill`, and an orphan-pixel count; writes `out/gate.json`.
- `room-shell/`: the 192x120 Features from the room-shell prototype. `out/rejected/`: first attempts thrown out (see the issue).

Verdict and findings: see the resolution comment on issue 71.
