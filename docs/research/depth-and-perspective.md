# Depth and forced perspective in 2D pixel-art Scenes

Research for issue #65, checked 2026-10-24. Answers: how pixel-art games and illustrations make a flat picture read as a space you are inside, without 3D, and what each technique implies for a Scene plan that today has draw-ordered Layers with no depth, one Scale per Scene, Elements generated at display size, and backdrops fixed at 128x64.

Primary sources only: artist write-ups (Slynyrd, Saint11), developer write-ups (Sébastien Bénard on Dead Cells) and engine docs (Godot, Phaser, Tiled, Unity). Pixel Logic (Michafrar) is paywalled and could not be read; the Lospec listings for Cyangmou and Pix3M are image-only or 404; GDC Vault pages for Owlboy, Ori, Rayman Legends and Celeste were unreachable in this pass. Spelunky room data comes from Darius Kazemi's analysis of Derek Yu's running game, which is secondary.

## Recommendation in one paragraph

Depth in pixel art is a colour and composition job first and a motion job second. Every artist source agrees on one rule: each plane further from the viewer loses saturation and contrast, and shifts toward the sky (or room) colour, with less detail per pixel. The Scene plan can do most of this without touching the Viewer: give each Layer an optional `distance` tag (near, mid, far) that the Director uses to write Element briefs and pick Palette ramps, and build backdrops as two or three planes instead of one. Three to six planes is the normal range; a cosy interior needs three (back wall, mid furniture, near frame). Parallax is optional and only earns its place if the Viewer gains a camera drift or pointer offset, because the Scene is static today. One-point perspective interiors work in pixel art when the vanishing point is at canvas centre and walls are flat panels whose line gaps widen toward the viewer. Framing with a foreground side (a wall edge, a curtain, a doorway) is the cheapest depth cue of all and needs no new mechanism: a large near prop flush to the canvas edge.

## Plane layering and plane counts

What the sources say:

- Slynyrd, Pixelblog 63 (horizontal shmup): "All together, there are 6 layers of depth with varied scroll speed." Front to back: grass, trees 1, trees 2, mountains with clouds 1, clouds 2, sky. Assets are 240 px wide on a 470x240 screen, looped twice.
- Slynyrd, Pixelblog 28 (side-view tiles): "I like to make several simple background layers"; "just a few is usually enough for convincing depth." Support tiles sit "in the immediate background" so the player passes in front.
- Slynyrd, Pixelblog 62 (landscape backgrounds): a valley is horizon bars, sky and ground bands, two mountain layers, a distant layer and clouds in "a few layers". Each scene uses 15 colours under a 16-colour limit. "The farthest clouds are baked into the sky background."
- Saint11, Clouds tutorial: "Far away clouds are faded. Closer clouds have strong contrast. I like to start from the background and move forward."
- Slynyrd, Pixelblog 11: "The closer an object is to the vertical position of the horizon, the more distant it appears."

Implication: three planes is the floor for a Scene that should read as a space, six is the ceiling before layers stop being distinguishable in 16 colours. For an interior: a back-wall plane (fill plus wall backdrop and anything hung on it), a mid plane (the furniture and the focal point) and a near plane (framing prop). For a view through a window: the far planes are the backdrop and the window frame is the near plane, as the composition doc already does. Nothing in the schema needs to change for this; it is a Director rule. The one structural change worth making is letting a backdrop be a plane rather than a whole picture: two 128x64 backdrops, one for the far hills and one for the mid treeline with transparent sky, drawn in two Layers, give the Director a far and a mid plane it can colour differently. That needs a transparent backdrop kind, which today is opaque by definition.

## Floor and wall planes in one-point or forced perspective

What the sources say:

- Slynyrd, Pixelblog 40 (one-point corridor): "Make a simple corridor with one point perspective, and the vanishing point at the center of the canvas." Canvas 96x58, "landscape format to capture a natural wide gaze." "Use only lines and solid color to make the walls." Walls are vertical-line panels and "The gaps between lines should grow larger as they extend out from the vanishing point." "Make it so the nearest panel is uncropped and flush to the canvas edges." Floor and ceiling are not described separately.
- Slynyrd, Pixelblog 64 (cabinet projection): x and y as a side view, "the z axis is captured with oblique lines that all run parallel at the same angle", about 67.5 degrees as "lines that go up two pixels and left one repeatedly". Any angle with clean pixel steps works; 45 degrees is also given.
- Slynyrd, Pixelblog 28: ground tiles have "a region on the outer face of the tile that appears to tilt towards the background", a three-quarter tilt; corners tilt on two sides "like a cabinet projection".
- Slynyrd, Pixelblog 3: three-quarter top-down is "viewing the house from 45 degrees above", showing "about 3/4 of both the roof and facade". "Uniformity takes priority over realism"; never mix projections in one scene.
- Antoine Gersant, Les Forges chapter 3 (Lospec-listed): RPG three-quarter view means "the horizontal planes are seen from above, the vertical planes are seen from the front". Walls and doors are drawn 1:1; barrel tops are circles.

Implication: a side-on room with a flat back wall and a floor band is the projection the Element library already fits, because every prop is "as seen from the front" (composition doc). A true one-point room needs a floor plane whose edges converge and side walls that are trapezoids, and props on it would need to shrink with depth, which one Scale per Scene forbids. The cheap middle ground the sources support is cabinet or three-quarter projection: keep the front faces 1:1, add a floor band that tilts toward the back wall, and draw side walls as oblique panels at a fixed pixel-step angle. That is a backdrop or a fill-plus-prop job, not a Viewer change. If the Director uses a one-point corridor, follow Pixelblog 40: vanishing point at canvas centre, flat-colour wall panels, nearest panel flush to the edge, and no props beyond the mid plane because they could not shrink.

## Scale falloff between planes

What the sources say:

- Slynyrd, Pixelblog 62: nearest grass has "thick apparent blades of vegetation", the next plane uses "one, or two pixel tall clusters at the most", farther planes "no longer depict single blades". A forest reads closer by "less extreme scaling of size and details from layer to layer". No numeric ratio is given.
- Slynyrd, Neomecity diary: cloud "circle sizes get smaller with each layer into the background to imply spacial depth"; "colors have slightly less contrast with each layer into the background".
- Saint11, Parallax and Depth table: details "many" near, "few" far.

Implication: scale falloff in pixel art is a detail-density rule, not a geometric one, and the artists do not quote a ratio. The Director can express it entirely in briefs: the far plane's brief asks for silhouettes and two-tone shading, the mid plane for normal detail, the near plane for the most contrast and texture. Where a subject genuinely appears at two depths (a tree near and a tree far), ADR 0003 already allows two Elements of the same subject at two sizes; the far one is a separate Element with a smaller `realSize`-derived canvas, not a scaled Placement. Cap this at two depths per subject to keep the library small.

## Atmospheric perspective

What the sources say:

- Slynyrd, Pixelblog 63: every layer behind the near grass is adjusted in Aseprite: "S -20, C -15, B +15" (saturation, contrast, brightness). The grass keeps its original colours.
- Slynyrd, Pixelblog 62: "the closest plane is the most saturated with strongest contrast between light and shadow"; "saturation reduces with each receding plane"; lightness rises with distance in daylight; "the hue shifts more to the color of the sky with each receding plane". Desert: orange sand to light yellow to light blue at the horizon; dark red shadows to violet to faded blue. Forest: the shift runs toward warm yellow where sunlight enters.
- Slynyrd, Pixelblog 11: "far objects become less saturated and contain less colors".
- Slynyrd, Pixelblog 40 (indoor corridor): "Apply a dithered texture with darker color to the far end of the walls at the center of the canvas" and a background gradient "with darker color in the center". Indoors, far means darker, not lighter.
- Saint11, Parallax and Depth: close versus far is saturation high/low, contrast high/low, light bright/dark, hue hot/cold, details many/few. "Objects far away are usually darker, less saturated and can fade to the sky color."
- Saint11, City Backgrounds: "2 colors for the sky", "2 colors for the far BG", "low color count for FG"; sky is "low saturation, low contrast". Modern/Indoors: walls "low saturation, low temperature"; posters "low contrast, low color count"; foreground furniture "high saturation, bright colors, high contrast".

Implication: this is the highest-value finding and the cheapest to adopt. Palettes are immutable (ADR), so the Director cannot post-adjust colours the way Slynyrd does in Aseprite. Instead, build the rule into Palette choice and briefs: a Palette for a Scene with depth should carry one high-contrast ramp for the near plane and one low-saturation, low-contrast ramp that leans toward the sky or wall colour for the far plane, and the far plane's brief should name two or three colours only. Outdoors the far ramp is lighter; indoors it is darker. A Quality gate check can enforce it: measure mean saturation and contrast per Layer in the composited Scene and warn when a far Layer out-contrasts a near one. Saint11's numbers (2 colours for sky, 2 for the far background) are a good default for backdrop briefs.

## Framing with sides

What the sources say:

- Slynyrd, Pixelblog 62 (forest): the vantage is "the shady embrace of thick foliage", trees "encompass the whole upper portion of the canvas", and the bottom is left open for heroes "with their backs to the screen".
- Slynyrd, Pixelblog 40: the nearest wall panel is "uncropped and flush to the canvas edges", which frames the corridor.
- st0ven, Background Art (Lospec-listed, archived): the main layer holds "plant growth and rock on the left hand side" in front of two cliff layers.
- No source gives a rule for curtains, doorways or wall edges specifically. That part of the question is unverified; the examples above are trees, a wall panel and rock.

Implication: the composition doc's interiors already do this implicitly with a window frame as the near prop. Make it explicit: a Scene that should feel inhabited gets one framing Placement in its last Layer, a large prop cut by a canvas edge (a wall edge, a curtain, a door jamb, a plant). It is the highest-contrast, most saturated thing in the Scene and may be the only Element that uses the near ramp. Because props are clamped to 128 px per axis, a full-height frame on a 120 px canvas fits; a full-width one does not, so frame with sides and the top, not the bottom.

## Parallax rates per plane

What the sources say:

- Slynyrd, Pixelblog 63 rates in px per frame: grass 4, trees 1 at 3, trees 2 at 2, mountains and clouds 1 at 1, clouds 2 at 0.5, sky 0.
- Slynyrd, Pixelblog 23: "I start with my furthest background layer scrolling at 1 pixel per frame", each nearer layer at "the next faster perfect rate" that divides the canvas width (96 divides by 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48). Rates under 1 px per frame "can look a bit jittery"; "you can't move a half pixel." "Balanced layers without dominant points of interest help hide the loop." Parallax "may not be convincing" if the still scene lacks depth.
- Saint11, Parallax and Depth: `render_x = (x - camera_x) * scroll_factor + offset_x`; camera moves 2 px per frame; foreground factor "greater than one"; UI factor zero.
- Godot Parallax2D `scroll_scale`: "a value of 1 scrolls at the same speed as the camera. A value greater than 1 scrolls faster, making objects appear closer. Less than 1 scrolls slower, making objects appear further, and a value of 0 stops the objects completely." The 2D parallax tutorial's example runs from sky (0.1, 1) to forest (0.7, 1). `repeat_size` loops the texture; `autoscroll` is "in pixels per second". ParallaxBackground and ParallaxLayer are "Deprecated: Use the Parallax2D node instead."
- Phaser 3 `scrollFactor`: "A value of 1 means it will move exactly in sync with a camera. A value of 0 means it will not move at all, even if the camera moves." The official example uses 1, 0.5, 0.25 and 0. `TileSprite.tilePositionX` scrolls a repeating texture.
- Tiled parallax factor: "By default its value is 1, which means its position on the screen changes at the same rate as the position of the camera." Lower is further, higher is closer, 0 is fixed; a group layer's factor multiplies its children.
- Unity has no built-in 2D parallax component; its docs cover shader parallax only. Sorting: "Sorting layer" then "Order in Layer" then distance as a tie-breaker, so draw order is separate from depth there too.

Implication: the Scene has no camera, so parallax is a hypothesis, not a gap. If the Viewer ever drifts the camera (a slow pan on a loop, or a pointer offset of a few pixels), the convention to copy is one number per Layer: `scrollFactor` with 1 for the mid plane, 0 for a fixed sky, under 1 for far planes, over 1 for the framing prop. Keep moves to whole pixels and let far planes move at 1 px per step, as Pixelblog 23 says, which on a 192 px canvas means loops of 1, 2, 3, 4, 6, 8, 12 or 16 px per step. Because backdrops are 128 wide on a 192 canvas, a parallax backdrop must `tileX`, and only `tileX` backdrops can carry a factor other than 1 without exposing an edge. Props cannot slide; a parallax prop would leave a gap at the canvas edge, so factors apply to backdrops and fills only. This is a Viewer feature with a schema field; do not add it until a drifting camera exists.

## Room shells from reusable pieces

What the sources say:

- Sébastien Bénard, "The level design of Dead Cells: a hybrid approach": rooms are pre-built "chunks of carefully designed rooms" made in CastleDB. Each tile "has a specific layout of platforms designed for a specific purpose", varied within "a handful of parameters": the number of entrances and exits and the room's purpose (treasure, merchant, combat). Each room belongs to one biome, so "rooms used in the prison aren't reused in the sewers". A per-biome concept graph places entrance and exit, then special rooms, then combat and exploration between them; for each node the generator tries random rooms until one matches the node's entrance count, location and type. Budget example: 250 combat tiles at one monster per 5 tiles gives 50 monsters.
- Spelunky, via Darius Kazemi's analysis of the running game: each room template is a 10x8 grid of tiles; each of four room types has 8 to 16 templates; probabilistic tiles ("4": 25 percent pushblock, "7": 33 percent spike, "2": 50/50 empty or brick); 5x3 obstacle blocks dropped into the template; rooms are randomly mirrored and most are symmetrical so the flip goes unnoticed.
- Saint11, Top Down Tricks: depth sort by foot position, order is `pos.Y + offset` with the offset "generally on the bottom of the collision box"; layers are "used to separate major groups".
- Slynyrd, Pixelblog 35 (top-down interiors) and 64: interiors and cities built from 16x16 tiles in "6 tile layers", foreground platforms connected to the buildings directly behind them.

Implication: the Element library is already a room-shell kit in the Dead Cells sense, parameterised by subject, Palette and size. What it lacks is the shell itself: wall, floor and ceiling pieces as reusable Elements rather than a `fill`. Add three shell Element kinds or tags, a wall backdrop (tileable, with a skirting line), a floor band and a side-wall panel, each generated once per Palette and reused, with `flipX` giving the mirrored side wall as Spelunky mirrors rooms. Keep the back wall flat and front-on so every existing prop sits on it without perspective mismatch, and let the floor band carry the only perspective cue (a tilted top face per Pixelblog 28). Bénard's "one biome per room" maps to one Palette per shell: shells are Palette-locked like any Element, and a Scene shops a shell before props so the Style anchor can be the shell. Vary shells by brief parameters (window count, door side, skirting) rather than by generating a new one per Scene.

## What a prototype should test

1. Recolour one existing interior Scene so the back-wall Layer uses a low-saturation, low-contrast ramp and the near prop uses the Palette's hottest ramp, and compare side by side. This isolates the atmospheric-perspective rule from everything else.
2. Build one room shell from three Elements (wall backdrop with `tileX`, floor band, side-wall panel with `flipX`) and place two existing props on it. Check the three-quarter floor tilt reads as a floor under front-on props.
3. Only if the owner wants motion: a pointer-offset drift of plus or minus 4 px with scroll factors 0, 0.5, 1 on three `tileX` backdrops, to see whether whole-pixel parallax reads at 192x120 or jitters.

## Sources

- Slynyrd, Pixelblog 3: https://www.slynyrd.com/blog/2018/3/14/pixelblog-3-graphical-projections-1
- Slynyrd, Pixelblog 11: https://www.slynyrd.com/blog/2018/11/16/pixelblog-11-landscape-pixeling
- Slynyrd, Pixelblog 23: https://www.slynyrd.com/blog/2019/11/12/pixelblog-23-parallax-scrolling
- Slynyrd, Pixelblog 28: https://www.slynyrd.com/blog/2020/5/21/pixelblog-28-side-view-tiles
- Slynyrd, Pixelblog 35: https://www.slynyrd.com/blog/2021/11/30/pixelblog-35-top-down-interiors
- Slynyrd, Pixelblog 40: https://www.slynyrd.com/blog/2022/9/25/pixelblog-40-3d-animation
- Slynyrd, Pixelblog 62: https://www.slynyrd.com/blog/2026/5/27/pixelblog-62-landscape-backgrounds
- Slynyrd, Pixelblog 63: https://www.slynyrd.com/blog/2026/7/26/pixelblog-63-horizontal-shmup
- Slynyrd, Pixelblog 64: https://www.slynyrd.com/blog/2026/9/25/pixelblog-64-ninja-platformer
- Slynyrd, Neomecity pixel diary: https://www.slynyrd.com/blog/2024/7/12/pixel-diary-neomecity
- Saint11 (Pedro Medeiros), tutorials index with Parallax and Depth, Clouds, City Backgrounds, Modern/Indoors, Top Down Tricks: https://saint11.art/blog/pixel-art-tutorials/ (image tutorials; text quoted from the images)
- Antoine Gersant, Les Forges chapter 3, Perspectives: https://opengameart.org/content/chapter-3-perspectives
- st0ven, Background Art (archived): https://web.archive.org/web/20120705043521/http://steve.neonstar.net:80/mini_background2.htm
- Sébastien Bénard, The level design of Dead Cells: https://deepnight.net/tutorial/the-level-design-of-dead-cells-a-hybrid-approach/
- Darius Kazemi, Spelunky Generator Lessons part 2 (secondary, analysing Derek Yu's game): https://tinysubversions.com/spelunkyGen2/
- Godot Parallax2D: https://docs.godotengine.org/en/stable/classes/class_parallax2d.html and tutorial https://docs.godotengine.org/en/stable/tutorials/2d/2d_parallax.html
- Godot CanvasLayer follow_viewport_scale: https://docs.godotengine.org/en/stable/classes/class_canvaslayer.html
- Phaser 3 ScrollFactor: https://docs.phaser.io/api-documentation/namespace/gameobjects-components-scrollfactor and example https://phaser.io/examples/v3.85.0/camera/view/set-scroll-factor
- Tiled layers manual, Parallax Scrolling Factor: https://doc.mapeditor.org/en/stable/manual/layers/
- Unity sprite sorting: https://docs.unity3d.com/Manual/sprite/sort-sprites/sort-sprites.html
