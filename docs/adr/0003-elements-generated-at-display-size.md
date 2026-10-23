# Elements are generated at display size, never scaled

Every prop in a Scene is drawn at the size it is shown, so each Element is generated at that canvas size from PixelLab's native sizes and the Viewer never scales a Placement. The Director sets one Scale (pixels per metre) per Scene and a real-world size per generated prop; the pipeline derives the canvas size from the two, rounding up to the smallest native size that contains it. Backdrops are exempt and keep their fixed canvas. The cost is that one subject may exist in the Element library at several sizes, each a separate Element, and reuse must match size as well as subject and Palette.

## Considered options

- Generate every prop at 64x64 and nearest-neighbour downscale to its target: makes reuse cheap, but a 64 to 24 px downscale breaks the 1 px outlines and shading the Style anchor exists to protect.
- A composition rule that only places same-scale props together: hides the problem rather than solving it, and rules out most cosy interiors.
- Per-Placement or per-Layer scale in the Viewer: pushes set-design reasoning into the engine and reintroduces scaling artefacts.
