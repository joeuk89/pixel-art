# Room shell prototype (wayfinder ticket 78)

PROTOTYPE, throwaway, never merged. Can a room shell built from tiled surfaces, with feature Elements layered on, look as good as the props?

Run: `npm start` (inlines the library Elements and `out/raw/*.png` into `index.html` and opens it). ← → switch variants; S texture source, F features, A atmospheric ramps, - / = room depth, N notes.

- `index.template.html`: the room box, the four ways of putting a texture on an oblique surface, the local textures and features drawn in code, and the projected and angled features.
- `generate.ts`: the PixelLab Pro Flash textures and features on cosy-night. 44 generations.

Verdict and findings: see the resolution comment on issue 78.
