# Composition

The Scene is 192x120. Layers carry draw order only: no depth, no parallax, no scaling. Each Placement draws at its Element's native size, so everything about size is decided by Scale and real size before anything is generated.

## Patterns are examples

Three Scenes as they might be decomposed. Read them for the kind of reasoning, then compose this Scene from its own Concept. A plan that matches one of these Layer for Layer, without the Concept asking for it, has copied an example and is a defect: change it.

**A close interior: a reading nook on a winter afternoon.** The window is the light source and the focal point is a dog asleep in an armchair. A `fill` Layer for the wall colour, a backdrop of snowy rooftops seen through the window, then the window frame as a large prop with transparent panes, the armchair, a side table, a stack of books and the dog. Snow falls inside the window region as a Primitive; the dog breathes as a Frame strip. Scale 64: the dog, 0.75 m long, lands at 48 px, the armchair at 64 px, and a 0.25 m stack of books on the table at 16 px. Mid bed of room tone, one feature sound of a ticking clock, far wind.

**A street: a noodle stall at night in the rain.** The stall's lantern is the light source and the stall is the focal point. Sky backdrop tiled across the width, a row of shopfronts as a second backdrop, the stall as the hero prop (2 m tall, so 48 px), a cat on a crate, puddles as small props on the pavement. Rain over the whole width, a glow on the lantern, a blink on a shop sign. Scale 24, the street default, already puts the stall at 48 px. Mid bed of traffic, far thunder as a One-shot.

**A view through a window: an attic window over moonlit hills.** The moon is the light source and the focal point is the window itself. A `fill` Layer for the dark roof beams, a backdrop of hills and a starry sky showing through the window, then the window frame as the hero prop (1 m square, so 48 px) with transparent panes, a potted plant on the sill and a cat watching from beside it. A twinkle Primitive on the stars; the cat's tail twitches as a Frame strip. Scale 48: the room is the setting, and backdrops keep their fixed canvas whatever the Scale, so the hills stay wide. Mid bed of a quiet night interior, far wind, an owl as a far One-shot.

Other Scenes may need no backdrop, a single giant prop, or a near-empty frame. Compose what the Concept asks for.

## Scale defaults

Scale is pixels per metre, one per Scene. Pick the row that fits the setting, then tune it so the hero prop lands near 48 px.

| Setting | Scale |
| --- | --- |
| Close interior (a desk, a nook, a shelf) | 64 |
| Room | 48 |
| Street or garden | 24 |
| Landscape | 8 |

Props render at `scale` x `realSize`, rounded up to the next multiple of 4 and clamped to 16 to 128 px per axis; `derive-canvas` does the arithmetic. A prop that would land under 16 px is drawn at 16 px and looks too big next to its neighbours: drop it, or fold it into a larger prop's brief.

## Reference heights

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

Motion the catalogue lacks is never painted into an Element. Put it on the missing-Primitive list for the Plan gate with the nearest existing Primitive, or none; the owner answers "build it" or "use the nearest" for each.

## Backdrops

Backdrops are 128x64, opaque and tileable. Use `tileX` to span the Scene width, or place one where it is needed. Sky gradients and stars are backdrops, not fills. A `fill` Layer paints the whole Scene in one Palette index.
