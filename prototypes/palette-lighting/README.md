# Palette lighting prototype (wayfinder #68)

PROTOTYPE, throwaway. Does palette lighting look right on a real Scene, and what does the pass cost at 192x120 and 384x240?

Run `npm start` here, then open <http://localhost:8068/prototypes/palette-lighting/>.

The page runs the penthouse through the real Viewer compositor and Primitives, then applies a ramp-lighting pass on top. Switch variants with the bottom bar or the arrow keys (`?variant=A..D`):

- **A, v1 as shipped**: the real `glow` Primitive, no lighting pass.
- **B, ramp lighting, hard steps**: every pixel moves along its colour's ramp by a whole-step light level. Every pixel stays a Palette colour.
- **C, ramp lighting, Bayer dither**: as B, with a 4x4 Bayer threshold on the fractional level, so light falls off in dithered bands.
- **D, ramp lighting plus a smooth halo**: as B, plus an unsnapped full-colour additive halo round the lamp shade. Not palette-true; there for comparison.

Lights: the floor lamp (warm, near, flickering) and the city glow through the windows (cool, far, lighting only the room side). The sky and city planes take a far-plane offset. Pixels marked emissive (city windows, twinkles, the lamp shade) ignore ambient and the far-plane offset.

The panel switches between hand-written ramps (same-hue steps from the Palette's four ramps) and generated ramps (Oklab: darken towards the darkest colour, light towards the light's colour, snap to the Palette), shows the ramp tables, overlays the light-level field, and benchmarks the pass. Press `F` for fullscreen, `H` to hide the panel.
