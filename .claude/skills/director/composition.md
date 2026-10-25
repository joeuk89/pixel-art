# Composition

The Scene is 384x240. Each Placement draws at its Element's native size and the Viewer never scales, so everything about size is decided by the Stage, the Scale and real sizes before anything is generated. [staging.md](staging.md) holds the depth rules; this file holds worked examples, real sizes and motion.

## Patterns are examples

Three Scenes as they might be decomposed. Read them for the kind of reasoning, then compose this Scene from its own Concept. A plan that matches one of these Layer for Layer, without the Concept asking for it, has copied an example and is a defect: change it. The standing rule is freedom over templates.

**A close interior: a reading nook on a winter afternoon.** A 3 m wide nook, 2.4 m high, eye height 1.1 m; the window is the light source and the focal point is a dog asleep in an armchair beneath it. The window is an Opening in the back wall with a Backdrop of snowy rooftops at its size, so the zoom is 1.25. A plaster back wall, a boarded floor with a rug, a bookshelf against the back wall. The armchair, side table and dog stand on `foot` positions; a tall plant on the near Plane is cut by the canvas edge. Snow falls inside the Opening as a Primitive; the dog breathes as a Frame strip. Daylight, so the ambient level is near 0 and the window spill does the work.

**A street: a noodle stall at night in the rain.** Outdoors, 20 m of street 12 m deep, horizon at 1.6 m; the stall's lantern is the light source and the stall is the focal point. A sky Backdrop at the canvas width, a row of shopfronts as distinct props with varied heights, the stall as the hero prop on its `foot`, a cat on a crate, puddles. Rain over the whole width, a blink on a shop sign, the lantern a warm point Light with a Halo. Mid bed of traffic, far thunder as a One-shot.

**A view through a doorway: an attic over moonlit hills.** The moon is the light source and the focal point is the hills. No room box: a near wall Element with a transparent doorway frames a far Backdrop of hills and stars, sized to the doorway's opening. A cat sits in the doorway on its `foot`. A twinkle Primitive on the stars; the cat's tail twitches as a Frame strip; the moonlight is a cool point Light `at` a canvas point. Mid bed of a quiet night interior, far wind, an owl as a far One-shot.

Other Scenes may need no Backdrop, a single giant prop, or a near-empty frame. Compose what the Concept asks for.

## Real sizes

`derive-canvas` turns a prop's `realSize` into its canvas at the Scale where it stands, rounded up to a multiple of 4 and clamped to 16 to 256 px a side. A prop that would land under 16 px is drawn at 16 px and looks too big next to its neighbours: drop it, or fold it into a larger prop's brief.

Real sizes are width x height in metres, as seen from the front.

| Thing | Height |
| --- | --- |
| Door | 2 m |
| Armchair | 1 m |
| Cat lying down | 0.25 m |
| Mug | 0.1 m |

Size other props against these: a desk is about the armchair's height, a window sill about half a door, a book a little taller than the mug.

## Motion

Decide motion per Placement, in this order:

1. Use a catalogue Primitive, or build one: if a Primitive in the catalogue supplies the motion, use it, anchored to the Placement it belongs to.
2. If the Element is a living thing or soft matter that should move subtly (a sleeping cat, a plant), give its `generate` block a `strip` (PixelLab, 5 frames by default).
3. Otherwise the Element is static.

Light is not motion: a lamp is a point Light with a Halo, set in the Variant by lighting.md.

Motion the catalogue lacks is never painted into an Element. Put it on the missing-Primitive list for the Plan gate with the nearest existing Primitive, or none; the owner answers "build it" or "use the nearest" for each.

## Fills

A `fill` Layer paints the whole canvas in one Palette index: a night sky behind a Backdrop, or a wall colour in a Scene with no Room shell.
