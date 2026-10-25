# Briefs

A brief is the text `generate-element` sends to the image service for one Element: PixelLab Pro Flash, or for a Backdrop over 256 px on an axis, the service picked with `--service`. It names one subject and how that subject looks at rest.

## Wording

- Lead with the subject noun, then two or three visual descriptors: material, colour, pose. "tabby cat asleep, curled up", "wooden window frame, four panes".
- Describe the Element alone. Neighbours, the room and the light belong to other Elements, to Primitives and to the Variant's Lights.
- End every brief with the light on the Element: each brief names the Element's light direction from the Light nearest it, such as "warm light from the left" for a chair beside a lamp.
- Ask for transparent openings wherever the backdrop must show through: "transparent panes", "open doorway, transparent inside", "gaps between the railings transparent".
- Write a Feature brief square-on: "front view, flat on", as if the Feature hung straight in front of the viewer. The pipeline fits it to its Surface.
- For a Backdrop, describe only the view, as if nothing stood between it and the viewer, and say it fills the whole canvas edge to edge. Name no window, frame, sill, curtain, interior or "through": the room draws its own Opening.
- Keep the Concept's specific details: if the Prompt said "a chipped blue mug", the brief says "chipped blue mug".

## Ban list

Every brief passes this list. Rewrite any brief that contains:

- motion that a Primitive in the catalogue supplies, or that a Frame strip will add (steam, rain, flicker, sparkle and the like)
- "hot"
- "steaming"
- "glowing"
- "switched on"
- "lit"
- "dithered"
- perspective words: "in perspective", "receding", "angled", "seen from the side"

These words make the service paint the effect into the still, where it then fights the Primitive or freezes; "dithered" gives noisy gradients the Ramp lighting cannot shade; perspective words skew a Feature the pipeline will project anyway. Describe the object switched off and at rest: "brass desk lamp", not "glowing desk lamp"; "mug of tea", not "steaming mug".

## House style

House style comes from the brief, the Palette (`target_palette`), `no_background` for props, the Style anchor (`style_image`) and its `style_options`. `generate-element` sets everything except the brief. A prop that fills its whole canvas with one pale shape, such as a blank sheet of paper, needs `removeBackground: false` in its generate block, or background removal erases it. Pro Flash rejects outline, shading, detail and view parameters, so style words in the brief are wasted: spend the words on the subject.

## Style anchor

The Style anchor is the hero prop: 48 to 96 px on its longer side and roughly square, never a Backdrop, never downscaled or cropped. It is generated first, with no style image, and every later Element is sent it as the style image where it fits the canvas. The Director never anchors an Element on its own subject: `generate-element` leaves the style image out when a Placement's subject matches the anchor's, because the service then returns a copy of the anchor. Name it at the Plan gate. When every prop that could anchor is reused, the Scene has no generated anchor; say so at the Plan gate.

## Element ids and tags

Propose ids as `<subject>-<two-or-three-descriptors>-01`, for example `lamp-brass-desk-01`; the pipeline bumps the number on collision. `tags` are the words a later Scene would search for: subject, setting, time of day, material.
