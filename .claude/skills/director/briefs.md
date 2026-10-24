# Briefs

A brief is the text `generate-element` sends to PixelLab Pro Flash for one Element. It names one subject and how that subject looks at rest.

## Wording

- Lead with the subject noun, then two or three visual descriptors: material, colour, pose. "tabby cat asleep, curled up", "wooden window frame, four panes".
- Describe the Element alone. Neighbours, the room and the light belong to other Elements and to Primitives.
- Ask for transparent openings wherever the backdrop must show through: "transparent panes", "open doorway, transparent inside", "gaps between the railings transparent".
- For a backdrop, say what fills the whole 128x64 canvas and that it tiles left to right when it will be tiled.
- Keep the Concept's specific details: if the Prompt said "a chipped blue mug", the brief says "chipped blue mug".

## Ban list

Every brief passes this list. Rewrite any brief that contains:

- motion that a Primitive in the catalogue supplies, or that a Frame strip will add (steam, rain, flicker, sparkle and the like)
- "hot"
- "steaming"
- "glowing"
- "switched on"
- "lit"

These words make the service paint the effect into the still, where it then fights the Primitive or freezes. Describe the object switched off and at rest: "brass desk lamp", not "glowing desk lamp"; "mug of tea", not "steaming mug".

## House style

House style comes from the brief, the Palette (`target_palette`), `no_background` for props, the Style anchor (`style_image`) and its `style_options`. `generate-element` sets everything except the brief. Pro Flash rejects outline, shading, detail and view parameters, so style words in the brief are wasted: spend the words on the subject.

## Style anchor

The Style anchor is the first generated prop: at least 48 px on its longer side, a square 48 px hero prop preferred, never a backdrop, never downscaled or cropped. Name it at the Plan gate. When every prop at 48 px or more is reused, the Scene has no generated anchor; say so at the Plan gate.

## Element ids and tags

Propose ids as `<subject>-<two-or-three-descriptors>-01`, for example `lamp-brass-desk-01`; the pipeline bumps the number on collision. `tags` are the words a later Scene would search for: subject, setting, time of day, material.
