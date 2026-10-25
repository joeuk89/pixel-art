# Lighting is a Ramp pass in the Viewer over Palette-locked Elements

Elements are generated unlit: flat, at rest, locked to the Scene's Palette, with no light painted in. The Viewer lights the whole frame at play time in one Ramp pass. Each pixel's light level is the Variant's ambient level, plus its Layer's offset, plus the point and beam Lights at that pixel. The level moves the pixel along its colour's Ramp: darker steps below 0, warm or cool lighter steps above it. Every lit pixel is still a Palette colour, so the Scene keeps the look the Palette and the Style anchor give it.

The Halo is the only exception. A point Light may draw a smooth additive bloom in one Palette colour after the Ramp pass, unsnapped, because a lamp read as flat steps at 384x240 in the prototype. Emissive colours are not an exception: they keep their own Palette colour.

The Director places the Lights and the owner tunes them in the Tuner; Briefs leave out light words, and the ban list enforces that. The palette-lighting prototype (#68) measured the pass at 0.58 ms a frame at 384x240 with a Halo, and the cached light field means a steady Light costs nothing between ticks.

## Considered options

- Paint light into each Element, as v1 did: nothing in the room responds to the lamp, a dusk or a clear-night Variant needs every Element generated again, and two Elements lit from different sides never agree.
- Blend light in RGB (multiply or add per pixel): smooth, but every lit pixel leaves the Palette, which muddies the pixel art and breaks the Palette lock the Quality gate checks.
- Normal maps or WebGL lighting: the services do not return normals, and the Viewer stays in Canvas 2D (#64).
- A companion Palette per mood instead of Ramps: kept only as a fallback for a mood the Ramps cannot reach, because a whole-Palette swap cannot light one corner of a room.
