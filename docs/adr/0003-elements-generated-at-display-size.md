# Elements are generated at display size, with Scale per depth, and Features are projected by the pipeline

Every Element in a Scene is drawn at the size it is shown, and the Viewer never scales. The Viewer and the Poster renderer draw every pixel 1:1.

A Scene's `scale` is pixels per metre at the back of its Stage. A prop standing on the floor takes the Scale at its foot, `scale × (foot.y − vanishingPoint.y) / (back.y + back.h − vanishingPoint.y)`, and is generated at that size, so a chair at the back of the room is a smaller Element than one at the front. A far Layer beyond the room may set its own Scale. A Scene without a Stage has one Scale for every prop. `derive-canvas` does the arithmetic, rounding each side up to a multiple of 4 within 16 to 256 px. A Backdrop is generated at the size of the Opening or region it covers.

A Feature on the back wall is drawn 1:1. A Feature on a side wall or the floor is generated square-on at the Scale of its nearest edge. The pipeline then projects it onto its Surface through the Stage into a derived file in the Scene folder, so projection only ever shrinks it. The library keeps the square-on source, and the derived file can be rebuilt from the source and the Stage.

One subject at two depths is two Elements, and reuse must match size as well as subject and Palette.

## Considered options

- Generate every prop at one size and nearest-neighbour downscale it in the Viewer by depth: makes reuse cheap, but a downscale breaks the 1 px outlines and shading the Style anchor exists to protect.
- One Scale for the whole Scene, ignoring depth: a chair at the back is as large as one at the front, so the room reads as a flat collage again.
- Project Features in the Viewer at play time: the Viewer would resample pixels every frame. The pipeline projects once, snaps the result to the Palette, and the owner judges it at the preview.
