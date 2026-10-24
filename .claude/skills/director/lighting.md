# Lighting a Scene

The Viewer lights the Scene at play time. Every pixel moves along its colour's Ramp by a light level: the Variant's ambient level, plus its Layer's offset, plus the sum of the point and beam Lights at that pixel. Lit pixels stay on the Palette. The only exception is a point Light's Halo, which draws last as a smooth additive glow in one Palette colour.

## Flicker

A point Light with `flicker: { depth, rate }` flickers at 10 fps from the Scene seed. `rate` is the speed of the swing in Hz, and `depth` is how far the Halo dims at the bottom of a swing. On a deep dip, the deepest fifth of the swing, every pixel the Light lights by a full step or more drops one Ramp step, so the pool on the floor breathes. A Light without flicker costs nothing between frames. Flicker only flame and old incandescent bulbs; a screen or the sky never flickers.

## Hard circles at a Light's edge

At night levels, each Light's edge shows as a hard circle where its level crosses a Ramp step. The prototype at 384x240 showed it on every lamp. Soften it by eye in the Tuner, with these tools:

- `dither: true` breaks each step into a 4x4 ordered pattern, so the edge falls off in a dithered band instead of a line.
- A wider `radius` with the same `strength` spreads the steps further apart, so each ring is fainter and further from the lamp.

Nothing measures the edge. The owner judges it at the preview.
