# Pixel-art techniques that make a Scene beautiful, and where each one belongs

Research for issue #62, checked 2026-10-24. Answers: which techniques strong pixel artists and pixel-art games use that this pipeline does not, and which fit a Scene whose Elements come from PixelLab Pro Flash under a Palette lock and a Style anchor, and are composited by the Canvas 2D Viewer. For each technique: what it is, a reference, and whether it belongs in generation briefs, Palette design, the Viewer, the Director's composition rules, or nowhere.

Context this serves: v2 adds depth (planes, sides, floor, forced perspective), a Viewer-side palette lighting pass (every Palette colour gets a dark-to-lit ramp), unrepeated backdrops and possibly a 384x240 canvas. Palettes are 16 colours by default and immutable once locked (ADR 0001).

## Summary: where the techniques land

| Technique | Belongs in | One-line reason |
| --- | --- | --- |
| Hue-shifted ramps | Palette design | Ramps are the Palette; the generator only picks from them |
| Shared darkest, lightest and neutral steps | Palette design | Ties materials together and frees slots in a 16-colour Palette |
| Palette lighting as a per-colour ramp lookup | Viewer, from ramps written in Palette design | Documented practice (LutLight2D, PixaVoxet, Ferrari); the glow Primitive already does a one-off version |
| Atmospheric perspective | Viewer (per-plane ramp step) plus Director (plane order) | A lighting-pass offset per plane gives it for free |
| Colour count discipline | Palette design and the Quality gate | 15 to 16 colours per scene is what the best landscape work uses |
| Selective and coloured outlines | Nowhere in briefs; Quality gate check only | Pro Flash rejects outline parameters; the Style anchor carries the outline style |
| Dithering | Nowhere (ban it) | Small Elements, 16 colours and animation are the three cases artists avoid it for |
| Clusters, orphans, jaggies, banding | Quality gate rubric and Palette design | Checkable defects; shorter ramps reduce banding |
| Pillow shading | Quality gate rubric | Needs a key light; briefs cannot name the light, so reject it after the fact |
| Subpixel animation | Viewer Primitives and Frame strip briefs | "Mostly move light, avoid moving shapes" is exactly a ramp shift |
| Idle timing and frame counts | Viewer (uneven timing) and Director (strip length) | 2 to 6 frames, extremes held longer |
| Palette cycling | Viewer | Same principle as palette lighting; time of day and water are palette operations |
| Integer snapping, no sub-pixel motion | Viewer (already true) | Keep it at 384x240 |
| Planes, floor line, overlap, scale falloff | Director composition rules | Three planes minimum, size steps per plane |
| Side walls and floor in forced perspective | Briefs for structural Elements and Director rules | A tilted top edge on a side-view tile is the documented trick |
| Key light, cast shadows, bounce, rim | Director (placement of lights), Viewer (pass) | One key light per Scene; shadows two ramp steps darker |
| Smooth 2D lights and normal maps | Nowhere | Engine docs show they compute at viewport resolution and break the pixel grid |
| Modular, non-repeating backdrops | Director composition rules | Landmark every screen, small variations per module |

## 1. Hue-shifted colour ramps

**What.** A ramp is a set of colours ordered by luminosity. A straight ramp changes only value; a hue-shifted ramp bends its light end toward one hue and its dark end toward another. The consistent direction across sources is light toward yellow, dark toward blue or purple: ENDESGA's quicktip ("Going Lighter -> Yellows/Greens. Going Darker -> Blues/Purples"), Jason Perry, BMR and Slynyrd all say so. Slynyrd builds ramps in HSB with about 20 degrees of hue per step ("20 is about as high as I go"), saturation peaking mid-ramp and never reaching 0 or 100 percent, darks carrying more saturation than lights, and brightness steps shrinking near white. The Aseprite community quotes a gentler rule: 5 to 10 degrees of hue and about 20 of brightness per step. Pixel Parmesan argues hue shifting is not a technique at all but the visible result of light colour plus local colour, and warns that yellow and violet keys break the pattern.

**Reference.** Slynyrd Pixelblog 1, cure's PixelJoint tutorial, Sweetie 16's warm ramp (#5d275d, #b13e53, #ef7d57, #ffcd75: purple to red to orange to yellow).

**Belongs in: Palette design.** The generator never invents colours under a palette lock, so a Scene can only be as hue-shifted as its Palette. The house Palettes already lean this way (cosy-night runs #120e1a to #5d4e7f and #5e2f22 to #f7d35c), but neither is written as explicit ramps. v2's lighting pass needs each colour's dark-to-lit ramp anyway, so write new Palettes as ramps first and flatten them to the 16-colour list second. Not a brief concern: Pro Flash rejects shading parameters and the words are wasted.

## 2. Shared steps and ramps per material

**What.** Ramps "often share their darkest and lightest shades" and share neutral mid-tones such as brown or grey (cure). DawnBringer made bright colours yellower and dark colours purpler so any ramp picked by luminosity still harmonises; one grey serves as the main colour of nine different materials in Surt's tileset (OpenGameArt LPC thread). Perry: ramps should overlap, and a colour can be a large cluster colour in one material and a thin buffer colour in another. Bart: "it's okay to sacrifice an accurate hue in favor of accurate luminosity."

**Belongs in: Palette design.** A 16-colour Palette cannot hold a private 4-step ramp for every material. Four ramps of four that share one darkest and one lightest step is the Sweetie 16 structure and fits the default count. The lighting ramps for v2 should be allowed to cross into a neighbouring ramp's steps (a lit wood step may be the warm ramp's highlight), which is how classic palettes achieve the look with so few colours.

## 3. Colour count discipline

**What.** Slynyrd limits a full landscape to 16 or fewer colours; his finished Valley, Desert and Forest scenes use 15 each, with clouds, far mountains and far trees reusing sky and near-tree colours. His Amnesic Valley diary cut a scene from about 24 to 16 ("16 is a sweet spot for me") and establishes value before hue. Wayline: 8 to 32 for a whole scene; check readability by desaturating. cure: "If you can't make a good sprite in 4 colors, using 40 colors isn't going to help." Saint11 on consistency: the commonest fault in unlimited-colour games is sprites not using colours they could share; a fixed palette is "fire and forget".

**Belongs in: Palette design and the Quality gate.** The 16-colour default is right and matches the best primary-source practice; do not raise it for 384x240. Two additions: the Quality gate could count how many Palette colours an Element uses and flag Elements that use fewer than three (flat) or that never touch a ramp's dark step (no shadow side); the Palette's `mood` text could say which ramp each material takes, so the Director picks `fill` and Primitive colours from the right ramp.

## 4. Palette lighting as a per-colour ramp lookup

**What.** Lighting pixel art by replacing each palette colour with a step along its own ramp, driven by a light value. Documented twice as runtime systems. LutLight2D (Unity): "a shading gradient for each palette color, starting from the original, lightest, to the darkest" in a ramps PNG baked into a LUT, with the step chosen by the brightness of the 2D light texture and optional interpolation between steps. PixaVoxet: rows of swatches "from lightest to darkest", step chosen by distance to the light, cast shadows rendered 2 steps darker, clamped to the end of the ramp. Mark Ferrari's scenes are the classic precedent: one flat image and one palette, with time of day done by fading the art "through whole sets of palettes", so light and shadow "climb down the sides of things, move across lawns" without touching the pixels. Mixing slow and fast gradients avoids the "pulsing flash" that gives colour cycling a bad name.

**Reference.** https://github.com/unitycoder/LutLight2D, PixaVoxet devlog, Ferrari Q and A (archived).

**Belongs in: the Viewer, fed by ramps written in Palette design.** This confirms the v2 lighting model and sharpens it:

- Each Palette colour needs an explicit ramp of about 4 to 6 steps (Apollo uses 6, Sweetie 16 uses 3 to 5). A Palette file gains a `ramps` field; the 16 flat `colours` stay immutable, so the ramps for existing Palettes can only be added, never changed.
- The light value per pixel is quantised to a ramp step before lookup. Interpolating between steps (LutLight2D's option, Ferrari's BlendShift) gives smoother gradients at the cost of leaving the Palette; keep it off except for the small set of allowed smooth effects such as a lamp halo.
- Cast shadows are a fixed step offset (2 steps in PixaVoxet), not a separate colour.
- The glow Primitive already blends to the nearest Palette colour; the lighting pass generalises that from one Primitive to the whole frame, and the Poster renderer runs the same pass.
- Time-of-day and weather variants are the same Scene under a different light map plus optional baked overlays (Ferrari's lit windows at night), which matches the map's in-scope item.

## 5. Atmospheric perspective

**What.** Each receding plane shifts toward the sky hue, loses saturation and gets lighter; the nearest plane is warmest, most saturated and has the strongest light-shadow contrast. Slynyrd's Pixelblog 63 recipe for layers behind the play layer: Saturation -20, Contrast -15, Brightness +15 per step. Far planes drop the darkest and brightest steps of their ramps (the far tower in Pixelblog 46 omits "the darkest color and pink highlights"). Reverse the shift when looking into the sun. PixelJoint's background guidance asks for at least three planes, each "less detailed", with lower saturation and contrast. No source gives a number of value steps per plane; the measurable rule in Slynyrd's scenes is one or two ramp steps dropped per plane back, from one shared 15-colour palette.

**Reference.** Slynyrd Pixelblog 62 and 63, PixelJoint news post 2024-06-10.

**Belongs in: the Viewer, with the Director naming planes.** Once lighting is a ramp lookup, atmospheric perspective is a per-Layer offset into the same ramps: a far Layer clamps every colour to the middle steps and biases toward the sky ramp. The Director's composition rules decide which Layers are far, mid and near. Nothing goes in briefs: a backdrop generated "hazy" bakes the haze at one time of day and fights the lighting pass, which is the same reason the brief ban list already excludes "lit" and "glowing".

## 6. Selective and coloured outlines

**What.** A black outline reads cartoony and segments the form harshly (Derek Yu). Selective outlining replaces black with lighter ramp colours where light hits and darker shadow colours for internal segmentation. Sam Keddy's rules: an outline "should always increase contrast, and never decrease it" and "should always be darker than both the object AND the background behind it"; internal lines take the colour one shade darker in each section. cure reframes sel-out as making a sprite read on any background, and warns an outline hugged by close shading is banding. Slynyrd prefers no outlines but uses them to keep sprites apart from backgrounds in a limited palette. Saint11 drops outlines first when space is tight.

**Belongs in: nowhere in briefs; the Quality gate checks it.** Pro Flash rejects outline parameters (briefs.md), so the outline style is carried by the Style anchor and cannot be dialled per Element. What the pipeline can do: the rubric's point 5 ("same hand") should name outline treatment explicitly, and point 4 can adopt Keddy's rule as a check: an Element whose outline is lighter than its fill, or that reads as a black cartoon line next to a lineless anchor, fails. Under the lighting pass, outlines drawn from ramp colours will light correctly for free; black outlines will not, which is one more reason to prefer anchors without them.

## 7. Dithering

**What.** Alternating two colours to fake a third or add texture. Every source restricts it. Helm: the smaller the sprite and the more colours available, the less to dither, "which would explain why dithering is almost never employed in the rendering of video game sprites". cure: if dithering covers half a sprite, add a colour instead; it suited CRTs that blurred the pattern. Yu uses it only on large flat areas (skies) or rough materials. Slynyrd's current style deliberately leaves out "lots of tiny clusters, dithering, and heavy AA". Ferrari used no dither on rain and snow paths so the cycling bands stay solid.

**Belongs in: nowhere.** Elements are 16 to 128 px, Palettes already supply ramps, and dithered pixels under a ramp-lookup lighting pass shift as two independent colours and shimmer. The Quality gate could reject checkerboard regions programmatically (count 2x2 alternating cells), and the brief ban list could gain "dithered" and "textured gradient". The one exception the sources allow, a large sky, is better served by a Palette with enough sky steps.

## 8. Clusters, orphan pixels, jaggies and banding

**What.** The cluster, a group of touching same-colour pixels, is the unit of pixel rendering: "Pixel clusters are the tool that the pixel artist uses to convey 99% of the render of their object" (Helm). Start from one silhouette cluster, segment into planes, then light. Defects: orphan pixels (a lone pixel "is a speck on a screen- its noise", allowed only for eyes, speculars, stars), jaggies (diagonal segments whose lengths do not grow or shrink evenly; "5, 2, 1, 2, 1 creates a lump, while 5, 2, 2, 1, 1 stays smooth", Keddy), banding (clusters hugging each other so the grid shows; "In pixel art we favor sharp transitions to avoid banding", Saint11). Slynyrd: "A single orphan or misplaced pixel in a looping animation is obvious."

**Belongs in: the Quality gate rubric, with Palette design reducing the risk.** These are checkable after generation and uncheckable before it. Programmatic candidates for the gate: orphan-pixel count outside a small allowance, and a banding heuristic (runs of parallel one-pixel-wide clusters along an edge). Rubric point 4 ("structure intact") should name jaggies and orphans. Shorter ramps in the Palette mean fewer steps to band with, which is another argument for 4 steps rather than 6 on most ramps.

## 9. Pillow shading

**What.** Shading by surrounding the shape with ever-darker bands that follow the outline instead of a light source (cure, Janes, Saint11). Fixed by a clear light source and by not darkening the edges of a face.

**Belongs in: the Quality gate rubric.** Briefs cannot name the light (the lighting pass owns it, and "lit" is banned), so the generator must shade from a neutral top light and the gate must reject Elements whose shading wraps the outline. Under v2 the Viewer adds the directional light, so Elements should be generated with the flattest honest shading the anchor allows: a mild top-down key, no cast shadow blob (already rubric point 1).

## 10. Subpixel animation

**What.** Faking movement smaller than a pixel: "mostly move light, avoid moving shapes"; "fade colors for an illusion of <1 pixel movement"; "note that the silhouette barely changes"; "too many colors makes everything look blurry" (Saint11, "<1 Pixel Movement"). Metal Slug's Fio breathes by colour shifts while her head "barely moves"; toggling four ponytail pixels on and off produces visible stutter. Slynyrd's water tile scrolls 1 px per frame while highlights alternate between two sub-pixel placements.

**Belongs in: Viewer Primitives, and Frame strip briefs for living things.** The Viewer half is direct: a breathing or flicker Primitive that steps a region's colours one ramp step up and down is subpixel animation by Saint11's definition and costs no frames. For Frame strips, the strip brief and drift check should prefer strips whose silhouette barely changes between frames: the existing drift failure already rejects large motion, and a silhouette-difference metric would catch the ponytail stutter case.

## 11. Idle timing and frame counts

**What.** Two frames is a complete idle (down 1 px with arms open, up 1 px); three frames smooths the fall; six frames adds hair lag and sub-pixel moves (Saint11, Character Idle). Uniform timing "felt a bit robotic", so hold the extremes longer: Slynyrd's 6-frame run uses 100/150/100/100/150/100 ms, idles run at 120 ms per frame, and an 8-frame cycle at 80 ms became 4 frames at 160 ms with the same energy. "Smooth movement doesn't necessarily equal good animation." Pair horizontal with vertical motion; move the interior after the silhouette.

**Belongs in: the Viewer and the Director.** The Frame strip type has one `fps`; adding per-frame durations, or a `hold` on the first and middle frames, gives the documented ease at no generation cost. The Director's default of 5 frames is in the right range; the rule to add is that a Frame strip moves by one pixel at a time and keeps mass constant, which the strip brief can say ("breathing, one pixel rise and fall, same outline").

## 12. Palette cycling and code-driven effects

**What.** Ferrari's rain is "a dot or dash of noticeably contrasting color on a long 'path'" whose other colours match the background it crosses; foliage sways by cycling edge leaves between leaf and background colours, syncopated so the tree does not look "like a metronome"; twinkling stars are "small color changes, low frame count, not all stars should animate, stars should be out of sync" (Saint11). Fire starts new waves every 2 or 3 frames and keeps the base's volume; smoke animates one particle at a time and avoids "breaking the shape too much or it will look like noise"; water never moves anything more than one pixel.

**Belongs in: the Viewer.** These are the design rules for Primitives, and most of the catalogue already follows them (rain, twinkle, glow, sway). The additions worth carrying into primitives.md: out-of-sync phases per particle, syncopated rather than uniform periods (Ferrari's mixed slow and fast gradients), one-pixel moves per tick, and colour changes drawn from the ramp of the pixel being touched rather than a fixed Palette index, which the lighting ramps make possible.

## 13. Integer snapping and no sub-pixel motion

**What.** Unity's Pixel Perfect Camera snaps sprites to the grid "to prevent subpixel movement" and renders at the reference resolution before upscaling; Godot's `snap_2d_transforms_to_pixel` rounds positions "at the cost of less smooth movement" and integer stretch "provides a crisp pixel art appearance". Slynyrd: parallax speeds under 1 px per frame "can look a bit jittery", so move 1 px every 2 frames; pixels moved per frame must divide the canvas width.

**Belongs in: the Viewer (already true).** The compositor blits at integer positions and the browser-rendering research settled integer scaling. For v2's optional slow parallax, Slynyrd's rule is the spec: whole-pixel steps on a fixed cadence, with the cadence per plane chosen so the loop length divides the backdrop width.

## 14. Planes, floor line, overlap and scale falloff

**What.** Side-view scenes stage depth as flat bands: paint "solid horizontal bars of color to define the horizon line" first, then split ground and sky into planes from the farthest forward (Slynyrd Pixelblog 62). Vertical position is itself a depth cue: "The closer an object is to the vertical position of the horizon, the more distant it appears" (Pixelblog 11). Scale falloff is a mood dial, not a fixed ratio: strong size and detail scaling implies a long view, mild scaling a short one; no source gives a per-plane ratio. Layer counts in practice are 6 (Pixelblog 63) to 9 (Pixelblog 46), with "at least 2 layers for parallax scrolling, but I think it really comes alive with 3" (Pixelblog 32). Parallax rates come from the divisors of the canvas width so loops close, and parallax "may not be convincing if your scene doesn't already convey depth when static" (Pixelblog 23). Nearer planes are warmer, more saturated and higher contrast (section 5). Interiors on 16-px tiles put the wall band at 32 px and rooms 11 to 14 tiles wide (Blake Crosley). A street scene lit from street level puts warm bounce low and cool light high (Slynyrd Pixelblog 42).

**Belongs in: the Director's composition rules.** composition.md says "no depth, no parallax, no scaling"; v2 replaces that with: name every Layer's plane (near, mid, far); a floor line per plane; Scale falls off per plane so a prop on the far plane is drawn at a smaller `realSize` x Scale (Elements are still generated at display size, keeping ADR 0003); overlap between planes is required, not incidental; and at least three planes when the Concept is a space rather than a close-up.

## 15. Side walls and floor in forced perspective

**What.** Side-view tiles fake a floor by tilting the top edge of each tile toward the background, with corners tilted on two sides "similar to a cabinet projection": "Creating tilted edges like this is critical to achieving depth" (Slynyrd Pixelblog 28). A forced-perspective street draws X and Y straight-on and "the z axis is captured with oblique lines that all run parallel at the same angle", about 67.5 degrees (up 2, left 1) to avoid jaggies; foreground platforms are "implied to be connected to the large buildings immediately behind" (Pixelblog 64). Never mix projections in one scene (Pixelblog 3). Reference interiors (Pokémon Emerald, measured by Blake Crosley) use a back-wall band of two 16 px rows per storey and rooms 11 to 14 tiles wide, with the floor flat below the wall band.

**Belongs in: briefs for structural Elements and the Director's rules.** This is the one depth technique that must be drawn into the Element, since the Viewer never rotates or skews. The structural kit in the map (walls, floors, ceilings, window frames in perspective) needs briefs that name the view ("side wall receding left, floor edge tilting toward the viewer"); subject words are what Pro Flash honours. The composition rules fix where the floor line sits so every structural Element is generated for the same eye level.

## 16. Key light, cast shadows, bounce and rim light

**What.** Establish one light source first; it fixes shadows, highlights and colour (Slynyrd Pixelblog 6; top-left or top-right is his default). Saint11 names key, fill and rim light and says "keep the light direction always consistent" and "change the hue when changing the amount of light"; in darkness use one colour to keep contrast low. Cast shadows are "usually a very sharp shadow" (Saint11), cast "predominantly to the left or right of objects, and slightly from the bottom" and kept on their own layer (Slynyrd Pixelblog 45); PixaVoxet renders them two ramp steps darker. Bounce light is a slightly brighter spot inside the form shadow; rim light comes from "a secondary, dimmer light" behind; specular only on glossy materials (Saint11 article 4). A light from directly above is what lets a tile be mirrored with `flipX`; a side key breaks mirroring (Pixelblog 28). Bounce and ambient colour follow from the relative complement of surroundings (Pixel Parmesan: grey beside orange reads blue). Volumetric cones show only "if enough dust or smoke are present".

**Belongs in: the Director (placement) and the Viewer (pass).** The Scene plan gains lights the Director places: one key light per Scene with a direction, plus point lights anchored to Placements (lamps, windows). The Viewer pass applies: lit side up one or two ramp steps, shadow side down, cast shadows a fixed two steps down onto the floor plane, and rim light as a one-step lift along the edge facing the key. Because the pass owns direction, Elements should be generated under symmetric top light so `flipX` stays valid. The Last Night's first version did something close to this pass: "Invisible colored points are sprinkled around" and sprites are tinted by "interpolating between the closest colors" (Tim Soret). Bounce is the Palette's job: warm ramps whose dark steps lean toward the floor colour. Nothing goes in briefs, which already ban "lit".

## 17. Smooth 2D lights and normal maps

**What.** Godot's 2D lights and Unity's URP Light 2D compute lighting at viewport resolution with smooth falloff and optional normal maps. Godot's own docs say lighting is computed "at the Viewport's pixel resolution, not the sprite texture's resolution", so a blocky look needs a shader that floors the light and shadow vertices, and shadow filter None is "best for blocky pixel-art looks"; Unity's URP notes "2D lighting is not physically-based" and asks for normal maps as secondary textures, which PixelLab does not return. Graveyard Keeper hand-paints a normal map per sprite from four lit sides; the Defold forum finds full-resolution normal maps give output that "does not ressemble any hand-drawn pixel art"; artists mixing them with pixel art (XDasher devlog, Graveyard Keeper write-up, Tim Soret) describe extra passes to re-quantise or accept a hybrid look.

**Belongs in: nowhere.** The map already restricts smooth gradients to a few effects such as a lamp halo. A ramp lookup gives the pixel-art result these engines need a corrective pass to approximate, and PixelLab does not return normal maps.

## 18. Modular backdrops that do not visibly repeat

**What.** "Balanced layers with no dominant focal points help hide the loop" (Pixelblog 23); distinct shapes such as mountains "are harder to loop convincingly", so make them wider, and "after a screen length or two at most, I would introduce a landmark" (Pixelblog 63). Cities are built from "single story block units that can be duplicated to expand the building to any size" (Pixelblog 42), one building per layer, duplicated with small variations under one palette so the skyline reads as "one cohesive mega structure" (Pixelblog 14). Any heavily used texture gets at least one variant (Pixelblog 45). Near skyline layers are drawn twice the viewport width because they repeat more often (GameMaker). Ferrari's scenes avoid repetition entirely by being single paintings.

**Belongs in: the Director's composition rules.** Keep `tileX` for sky and texture where repetition is invisible (the map's standing decision). For skylines, compose from building Elements with varied heights and a flipped variant (`flipX` already exists), place a landmark Element once, and overlap a nearer plane so the join between modules is never on an open stretch. Outpainting and strip generation are a separate research ticket.

## What a prototype should test

1. Write the penthouse Palette as ramps (4 to 6 steps per colour, shared darkest and lightest) and render the penthouse through a ramp-lookup lighting pass at one key light. Judge whether the quantised result reads as pixel art or as posterised shading.
2. Apply a per-Layer atmospheric offset (clamp to mid steps, bias toward sky) to the far plane and judge at fullscreen.
3. Generate three structural Elements with view words in the brief ("side wall receding left") and check Pro Flash honours them under the Style anchor.
4. Add a breathing Primitive that steps a region up and down one ramp step, and compare it against a 5-frame Frame strip of the same cat.
5. Add orphan-pixel and checkerboard counts to the Quality gate and run them over the current library to see the false-positive rate.

## Coverage note

Saint11's tutorials exist only as images on saint11.art; the text was read from the GIF panels, so quotes are transcriptions. No transcript was found for the GDC talks on Owlboy, Celeste, Eastward or Ferrari's 2016 talk; the Ferrari material comes from his archived Q and A and Joseph Huckaby's write-up instead. The Lospec glossary and several DeviantArt and Pixelation pages are gone; Helm's Pixelation knowledge repository was read from a 2016 Wayback copy.

## Sources

Colour and ramps
- Slynyrd, Pixelblog 1 Color Palettes: https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes
- cure, Creating Pixel Art (PixelJoint): http://pixeljoint.com/forum/forum_posts.asp?TID=11299
- ENDESGA hue-shifting quicktip (tweet text): https://api.fxtwitter.com/ENDESGA/status/971690827482202112
- Jason Perry, Using and Choosing Colors: http://finalbossblues.com/using-and-choosing-colors/
- Pixel Parmesan, Color Theory for Pixel Artists: https://pixelparmesan.com/color-theory-for-pixel-artists-its-all-relative/
- Aseprite community, palette advice thread: https://community.aseprite.org/t/designing-a-palatte-advice-needed/11637
- OpenGameArt LPC ramps thread: https://lpc.opengameart.org/node/20643
- Slynyrd, Pixelblog 62 Landscape Backgrounds: https://www.slynyrd.com/blog/2026/5/27/pixelblog-62-landscape-backgrounds
- Slynyrd, Pixel Diary Amnesic Valley: https://www.slynyrd.com/blog/2026/2/26/pixel-diary-amnesic-valley
- Slynyrd, Pixelblog 7 Developing Style: https://www.slynyrd.com/blog/2018/7/14/pixelblog-7-developing-style
- Saint11, Consistency: https://saint11.art/blog/consistency/
- Lospec palettes: https://lospec.com/palette-list/sweetie-16, https://lospec.com/palette-list/apollo, https://lospec.com/palette-list/resurrect-64, https://lospec.com/palette-list/endesga-32

Palette lighting and cycling
- LutLight2D: https://github.com/unitycoder/LutLight2D
- PixaVoxet indexed colour lighting: https://doublebody.itch.io/pixavoxet/devlog/67738/v107a-indexed-color-lighting
- Mark Ferrari Q and A (archived): https://web.archive.org/web/20140405004608id_/http://www.effectgames.com/effect/article.psp.html/joe/Q_A_with_Mark_J_Ferrari
- Joseph Huckaby, Old School Color Cycling with HTML5 (archived): https://web.archive.org/web/20130106200129id_/http://www.effectgames.com/effect/article.psp.html/joe/Old_School_Color_Cycling_with_HTML5
- Godot palette-swap post-process shader: https://godotshaders.com/shader/palette-swap-post-process-image-parametrized/

Outlines, dithering, clusters
- Derek Yu, Pixel Art Tutorial: https://www.derekyu.com/makegames/pixelart.html
- Sam Keddy, Pixel Art Outlines parts 1 and 2 (Lospec): https://lospec.com/articles/pixel-art-outlines/, https://lospec.com/articles/pixel-art-outlines-part-2-using-color/
- Helm, Pixelation Knowledge Repository (2016 Wayback): http://web.archive.org/web/20160324073951/http://www.pixel.schlet.net/
- Richard Janes, Introduction to Pixel Art: http://rjanes.com/tutorials/introduction_to_pixel_art.php
- Saint11 articles 2, 4 and 5: https://saint11.art/pixel_art_articles/article2/, https://saint11.art/pixel_art_articles/article4/, https://saint11.art/pixel_art_articles/article5/
- Saint11, Thoughts on Low Resolution: https://saint11.art/blog/thoughts_on_low_resolution/
- Saint11 glossary: https://saint11.art/blog/glossary/
- Slynyrd, Pixelblog 5 Back to Basics: https://www.slynyrd.com/blog/2018/5/16/pixelblog-5-back-to-basics
- Slynyrd, Pixelblog 59 Tiny Sci-fi Pixels: https://www.slynyrd.com/blog/2025/11/28/pixelblog-59-tiny-sci-fi-pixels

Animation
- Saint11 tutorial sheets (image text): https://saint11.art/img/pixel-tutorials/Subpixel.gif, characterIdle.gif, Easings.gif, Fire.gif, SmokeSheet.gif, Water.gif, Stars.gif, Wind.gif, IlluminationTechniques.gif, Darkness.gif
- Sub-pixel animation (Metal Slug Fio): https://someanimatorwannabe.substack.com/p/animator-techniques-sub-pixel-animation
- Tiny Warrior Games, sub-pixel animation: https://tinywarriorgames.com/2019/01/04/game-development-pixel-art-sub-pixel-animation/
- Slynyrd, Pixelblog 8 Intro to Animation: https://slynyrd.com/blog/2018/8/19/pixelblog-8-intro-to-animation
- Slynyrd, Pixelblog 55 Top-down Character Animation: https://www.slynyrd.com/blog/2025/3/24/pixelblog-55-top-down-character-animation
- Slynyrd, Side-view Run 'N Gun: https://www.slynyrd.com/blog/2026/1/26/side-view-run-n-gun
- Slynyrd, Pixelblog 61 Isometric Mecha Tactics (water tile): https://www.slynyrd.com/blog/2026/4/1/pixelblog-61-isometric-mecha-tactics
- Slynyrd, Pixelblog 23 Parallax Scrolling: https://www.slynyrd.com/blog/2019/11/12/pixelblog-23-parallax-scrolling
- Unity Pixel Perfect Camera 6.0: https://docs.unity3d.com/Packages/com.unity.2d.pixel-perfect@6.0/manual/index.html
- Godot project settings (snap_2d_transforms_to_pixel) and multiple resolutions: https://docs.godotengine.org/en/stable/classes/class_projectsettings.html, https://docs.godotengine.org/en/stable/tutorials/rendering/multiple_resolutions.html

Depth and light
- Slynyrd, Pixelblog 63 Horizontal Shmup: https://www.slynyrd.com/blog/2026/7/26/pixelblog-63-horizontal-shmup
- Slynyrd, Pixelblog 28 Side-view Tiles: https://www.slynyrd.com/blog/2020/5/21/pixelblog-28-side-view-tiles
- Slynyrd, Pixelblog 3 Graphical Projections: https://www.slynyrd.com/blog/2018/3/14/pixelblog-3-graphical-projections-1
- Slynyrd, Pixelblog 6 Light and Shadow: https://www.slynyrd.com/blog/2018/6/15/pixelblog-6-light-and-shadow
- Slynyrd, Pixelblog 42 Cyberpunk Pixel Art: https://www.slynyrd.com/blog/2023/1/30/pixelblog-42-cyberpunk-pixel-art
- Slynyrd, Pixelblog 46 Anti-gravity Racing Scene: https://www.slynyrd.com/blog/2023/9/25/pixelblog-46-anti-gravity-racing-scene
- Slynyrd, Pixelblog 11 Landscape Pixeling: https://www.slynyrd.com/blog/2018/11/16/pixelblog-11-landscape-pixeling
- Slynyrd, Pixelblog 14 Cityscapes: https://www.slynyrd.com/blog/2019/2/23/pixelblog-14-cityscapes
- Slynyrd, Pixelblog 32 Shmup Design part 2: https://www.slynyrd.com/blog/2021/2/15/pixelblog-32-shmup-design-part-2
- Slynyrd, Pixelblog 45 Bricks, Walls, Doors: https://www.slynyrd.com/blog/2023/7/21/pixelblog-45-bricks-walls-doors-and-more
- Slynyrd, Pixelblog 64 Ninja Platformer: https://www.slynyrd.com/blog/2026/9/25/pixelblog-64-ninja-platformer
- Saint11, article 4 Basic Shading: https://saint11.art/pixel_art_articles/article4
- Defold forum, normal-map lighting for pixel sprites: https://forum.defold.com/t/normal-map-lighting-for-2d-pixel-art-sprites/70967
- Blake Crosley, Pixel art structures: https://blakecrosley.com/en/blog/pixel-art-structures-on-iphone
- PixelJoint, background planes: https://pixeljoint.com/2024/06/10/6979/submit_news.asp
- Saint11, article 6 (hot light, cold shadow): https://saint11.art/pixel_art_articles/article6
- Godot 2D lights and shadows: https://docs.godotengine.org/en/stable/tutorials/2d/2d_lights_and_shadows.html
- Unity URP Light 2D properties: https://docs.unity.com/en-us/engine/6000.7/manual/unity2d/2d-urp/2d-index/2dlight-properties
- XDasher devlog on light and depth: https://pixel-beef.itch.io/xdasher/devlog/192949/4-things-we-did-to-add-light-and-depth-to-our-pixel-art-game
- Graveyard Keeper graphics effects: https://slava.lazybeargames.com/graveyard-keeper-how-the-graphics-effects-are-made
- Tim Soret thread on The Last Night's lighting: https://threadreaderapp.com/thread/976819508441681920.html
- GameMaker, parallax depth: https://gamemaker.io/blog/creating-depth-and-immersion-parallax
