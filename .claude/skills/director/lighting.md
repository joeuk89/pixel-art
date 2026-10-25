# Lighting a Scene

The Viewer lights the Scene at play time (ADR 0004). Every pixel moves along its colour's Ramp by a light level: the Variant's ambient level, plus its Layer's offset, plus the sum of the point and beam Lights at that pixel. Lit pixels stay on the Palette. The only exception is a point Light's Halo, which draws last, smooth and additive, in one Palette colour. Light is never painted into an Element: briefs describe objects at rest.

## Defaults

Light levels, offsets and strengths are signed Ramp steps; 0 is the colour as drawn.

**The light source.** The Concept's light source becomes a point Light anchored to its Placement, with `offset` at the emitting part (the bottom of a lamp shade, the wick of a candle). Its radius is about 2.5 m times the Scale at its foot, and its strength +2.5. Its tint is warm for flame and incandescent bulbs, with flicker 0.1 at 0.8 Hz; cool for screens, moonlight and sky. Give a lamp or a flame a Halo in its brightest warm Palette colour, about a fifth of the Light's radius.

**Window spill.** Window spill is a cool point Light `at` the Opening's centre, strength about +0.75 and radius about the Opening's width, whenever an Opening shows sky.

**Ambient level.** From the Concept's time:

| Time | Ambient level |
| --- | --- |
| day | 0 |
| golden hour | −0.5 |
| dusk | −1.5 |
| night | −2.5 |

Far Layers keep their Plane default, or shift toward the sky outdoors (a lighter offset for a bright sky, a darker one for a night sky).

**Beams.** Place a beam only when the Concept names a sun shaft; light from a window is spill, not a beam.

**Emissive colours.** Emissive colours are chosen at acceptance, from the 8x upscale: the colours that light themselves (lit windows, bulbs, screens), with a mask when the same colour also appears unlit in that Element. Pass them to `--accept` as `--emissive <i,j>`, with one `--emissive-region x,y,w,h` per lit area when the colour also appears unlit; the script writes the record's `emissive` and the mask.

## Variants

The first Variant is the Concept's time and weather and is the one the Poster shows. Propose a second only when the Prompt asks for one (a clear night beside a rainy one). Every Variant shares the Placements; it changes only lighting, Primitives and added sounds. The owner finishes the lighting by hand in the Tuner.

## Flicker

A point Light with `flicker: { depth, rate }` flickers at 10 fps from the Scene seed. `rate` is the speed of the swing in Hz, and `depth` is how far the Halo dims at the bottom of a swing. On a deep dip, the deepest fifth of the swing, every pixel the Light lights by a full step or more drops one Ramp step, so the pool on the floor breathes. A Light without flicker costs nothing between frames. Flicker only flame and old incandescent bulbs; a screen or the sky never flickers.

## Hard circles at a Light's edge

At night levels, each Light's edge shows as a hard circle where its level crosses a Ramp step. The prototype at 384x240 showed it on every lamp. Soften it by eye in the Tuner, with these tools:

- `dither: true` breaks each step into a 4x4 ordered pattern, so the edge falls off in a dithered band instead of a line.
- A wider `radius` with the same `strength` spreads the steps further apart, so each ring is fainter and further from the lamp.

Nothing measures the edge. The owner judges it at the preview.
