# Lighting pixel art at play time: Palette ramps and 2D light in Canvas and WebGL

Research for [issue #64](https://github.com/joeuk89/pixel-art/issues/64), part of map [#61](https://github.com/joeuk89/pixel-art/issues/61). Written 2026-10-24. Every fact below cites the source that owns it; pages were fetched on that date unless another date is given. Measurements were taken on this repo at commit `ffb1970` on an Apple M4 laptop running Node 22.

## Question

How do 2D engines and pixel-art games light palette-locked sprites at run time, and what would it take to do it in this Viewer and the Node Poster renderer? Cover indexed or ramp lighting, light maps and additive overlays, normal-mapped sprites (and whether PixelLab or Retro Diffusion can produce a normal or light mask), day-night palette remapping, pixel-true glows and halos, and the cost of a Canvas 2D per-pixel pass at 384x240 versus a WebGL fragment shader on a laptop left open all day. Name the approach that keeps every pixel a Palette colour and runs cheaply, and the approach for smooth effects.

## Recommendation

**Palette-true and cheap: ramp lighting.** Give every pixel a light level, and let that level pick a step along its colour's ramp in the Palette. Our Palettes are already 16 colours in four ramps of four steps (`library/palettes/cosy-night.json`), so "darker" means "one step down the same ramp" and the output is always a Palette colour. The whole pass is one lookup per pixel, `out = rgba[lut[index * levels + level]]`, which costs 0.011 ms per frame at 192x120 and 0.117 ms at 384x240 in plain JavaScript (measured, see Cost). Time of day is the same mechanism with a Scene-wide level offset, or a companion Palette (ADR 0001 forbids editing a Palette an Element is locked to, so night is a new Palette file with the same ramp layout).

**Smooth effects such as a lamp halo: additive light, then snap.** Add the light colour to the pixel under it with a falloff, then snap the sum to the nearest Palette colour, optionally with a 2x2 or 4x4 Bayer dither to fake the steps the Palette lacks. This is what the `glow` Primitive in `viewer/primitives.ts` already does: it adds the light colour at four ring alphas and looks the result up in an Oklab nearest-colour LUT keyed on (colour under, light colour, level). Rendered at the 192x120 Scene size it stays pixel-aligned; Celeste renders its light gradients at its 320x180 internal size for the same reason ([Berry 2017](https://noelberry.ca/posts/celeste_lighting/)).

**How they combine.** One software pass in the compositor, after the Layers are drawn and before `putImageData`: (1) build the light-level field from the Scene's lights and time of day, cached until a light's state changes; (2) remap every pixel along its ramp by that level; (3) draw the additive halos and snap. Because `pipeline/lib/poster.ts` renders the Poster with the same `createCompositor().render(0)`, the Poster gets identical lighting for free. A WebGL pass would break that parity: Node has no WebGL, so the Poster would need a JavaScript twin of the shader anyway.

**Do not pursue normal maps.** Neither PixelLab nor Retro Diffusion outputs one (their API specs contain no "normal", "light" or "emission" field); the only automatic route is Laigter's headless CLI, and the pixel-art community judges normal-mapped sprites as too smooth unless the normals are hand-made and the result is re-quantised to the palette ([Defold forum, 2022](https://forum.defold.com/t/normal-map-lighting-for-2d-pixel-art-sprites/70967)). Our light sources are fixed per Scene, so the Director can put the light direction in the Brief instead ("lit from the left by a warm lamp") and let the image service shade the Element once. The one cheap input worth keeping is an **emissive flag**: which Palette colours (lamp glass, a lit window) the ramp pass must not darken. Unity's `_MaskTex` plays this role for its 2D lights.

**Stay in Canvas 2D at the current resolution.** The full lighting pass at 384x240 and 24 fps costs about 0.5 ms of CPU per frame and under six minutes of one core over an eight-hour day (see Cost). A fragment shader would do the arithmetic for nothing, but the frame loop, the texture upload and the GPU wake per frame are the same, and WebGL adds context-loss handling, a `powerPreference` decision and a second code path. WebGL only pays off if lights are rendered at display resolution for sub-Scene-pixel gradients, which the 192x120 decision rules out.

## How the engines do it

All three engines light **per screen pixel in a fragment shader**, with a light texture or a light list, and multiply or add the result into the sprite colour. None of them constrains the output to a palette; pixel-true lighting is left to the game's own shader.

| Engine | Mechanism | Blend modes | Normal maps | Pixel-art note |
| --- | --- | --- | --- | --- |
| Godot 4.7 | `PointLight2D` is a texture added over the scene; `light()` runs in the regular draw pass | Add, Subtract, Mix (`Light2D` class) | `CanvasTexture.normal_texture` and `specular_texture` | Lighting is computed "at the Viewport's pixel resolution, not at the source texture's texel resolution"; nearest filtering "does not change how the engine renders lighting and shadows" |
| Unity URP 16.0.6 | Lights drawn into screen-space Light Render Textures, then combined with sprite colour | Multiply, Additive, Subtractive, Custom; four blend styles per renderer | Sprite secondary textures `_NormalMap`, `_MaskTex`; adds a depth pre-pass | Light textures default to "0.5x of screen resolution" |
| Phaser 3.88.2 | `Light2D` pipeline; Lambert diffuse from the normal map, quadratic attenuation, up to `maxLights` (10) | Multiplies `ambient + sum(lights)` into the sprite | Second URL in `load.image(key, [url, normalUrl])` | WebGL only: "Lighting has no effect in Canvas rendering" |

### Godot 4

- Model: "The way a light typically works is by adding a selected texture over the rest of the scene to simulate lighting." "Larger lights have a higher performance cost as they affect more pixels on screen." ([2D lights and shadows](https://docs.godotengine.org/en/stable/tutorials/2d/2d_lights_and_shadows.html), Godot 4.7)
- Pixel art: "If you create a pixel-art game and want pixelated or blocky lighting and shadows that match your art style, Nearest texture filtering will not achieve this effect. [...] To achieve pixelated lighting and shadows, use a custom shader to modify `LIGHT_VERTEX` and `SHADOW_VERTEX` to snap light sampling to a pixel grid." The page's shader: `LIGHT_VERTEX.xy = floor(LIGHT_VERTEX.xy / pixel_size) * pixel_size;` (same page). The other route is the `viewport` stretch mode with integer scaling: "The viewport stretch mode provides low-resolution rendering that is then stretched to the final window size." ([Multiple resolutions](https://docs.godotengine.org/en/stable/tutorials/rendering/multiple_resolutions.html))
- Blend modes: "The default Add is suited for most use cases." "Subtract can be used for negative lights." "The Mix blend mode mixes the value of pixels corresponding to the light's texture with the values of pixels under it by linear interpolation." (2D lights and shadows)
- Ambient: "CanvasModulate is used to darken the scene by specifying a color that will act as the base 'ambient' color." (same page; [CanvasModulate class](https://docs.godotengine.org/en/stable/classes/class_canvasmodulate.html))
- Where it runs: "In Godot 4.x all lighting is done during the regular draw pass. In other words, Godot no longer draws the object again for each light." `LIGHT_VERTEX` is "Pixel position, in screen space". ([CanvasItem shaders](https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/canvas_item_shader.html))
- Cheaper alternative the docs themselves offer: "Additive sprites are much faster to render, since they don't need to go through a separate rendering pipeline." (2D lights and shadows)

### Unity URP 2D Renderer

- "The lighting calculation in 2D Lights is not physics based as it is with 3D Lights." Phase one draws each light's colour and shape into a Light Render Texture; phase two combines it with the sprite: "the final color is calculated by combining the input color with colors from the Light Render Texture". ([Introduction to the 2D Lighting system, URP 16.0.6](https://docs.unity3d.com/Packages/com.unity.render-pipelines.universal@16.0/manual/Lights-2D-intro.html))
- Resolution: "By default it is set at 0.5x of screen resolution. Smaller Light Render Texture size will give better performance at the cost of visual artifact." (same page)
- Normal maps: "Using normal maps to simulate depth is currently a very expensive operation": a full-size render texture and a depth pre-pass per layer batch (same page). Sprites carry them as secondary textures `_NormalMap` and `_MaskTex` ([Add a normal map or a mask map to a sprite](https://docs.unity3d.com/6000.0/Documentation/Manual/urp/SecondaryTextures.html)).
- Blend styles: "The asset can contain a total of four different Light Blend Styles"; the predefined modes are shown as Multiply, Additive and Subtractive images ([Light Blend Styles](https://docs.unity3d.com/Packages/com.unity.render-pipelines.universal@16.0/manual/LightBlendStyles.html)). The mask channel is the emissive-style control: "A mask controls where lights can affect a sprite."
- Light types: Spot, Sprite ("Emits light in the shape of a sprite"), Freeform, Global ([Unity 6 manual](https://docs.unity3d.com/6000.0/Documentation/Manual/urp/Lights-2D-intro.html)). The [2D Pixel Perfect](https://docs.unity3d.com/Packages/com.unity.render-pipelines.universal@16.0/manual/2d-pixelperfect.html) page never mentions lights; its "Upscale Render Texture" option renders the scene at the reference resolution, which is the only way to get pixel-sized falloff (inference, not documented).

### Phaser 3

- "The Light Pipeline [...] uses a custom shader designed to handle forward diffused rendering of 2D lights in a Scene. The shader works in tandem with Light Game Objects, and optionally texture normal maps". `maxLights` "defaults to 10" and is baked into the shader through `%LIGHT_COUNT%`. ([LightPipeline.js, v3.88.2](https://github.com/phaserjs/phaser/blob/v3.88.2/src/renderer/webgl/pipelines/LightPipeline.js))
- The shader ([Light.frag, v3.88.2](https://github.com/phaserjs/phaser/blob/v3.88.2/src/renderer/webgl/shaders/src/Light.frag), 72 lines, `precision mediump float`): `normal = normalize(uInverseRotationMatrix * vec3(normalMap * 2.0 - 1.0))`; per light `diffuseFactor = max(dot(normal, lightNormal), 0.0)`, `attenuation = clamp(1.0 - distToSurf*distToSurf / (radius*radius), 0.0, 1.0)`, `finalColor += (attenuation * light.color * diffuseFactor) * light.intensity`; output `gl_FragColor = color * vec4((uAmbientLightColor + finalColor), 1.0)`. Lambert diffuse, quadratic falloff, no specular, no shadows.
- "It only works in WebGL render mode." Normal map: `this.load.image(key, [url, normalMapUrl]);` ([Light docs](https://docs.phaser.io/phaser/concepts/gameobjects/light)). Phaser 4.1 renames it the Light Filter: "Lighting has no effect in Canvas rendering." ([LightsManager](https://docs.phaser.io/api-documentation/class/gameobjects-lightsmanager))

## Indexed and ramp lighting (palette-true)

The idea: each Palette colour owns a ramp of shades, and the light level at a pixel picks the step. Every output pixel is a palette colour by construction.

- **LutLight2D** (NullTale, Unity URP 2D, MIT) is the canonical code example: "Stylized pixel art lighting shader for Unity2D using a color replacement technique." "The shader does this using a set of Lut tables generated from gradient ramps." "The Ramps file is a common .png which contains shading gradient for each color from the palette." "The color for replacement is taken from the tables depending on the brightness from the lighting texture." "Colors from the tables can be taken with interpolation blending, to make smooth transitions." ([README](https://github.com/NullTale/LutLight2D)) The LUT is indexed by (colour index, light level), which is exactly the `lut` table `glow` already builds in `viewer/primitives.ts`, minus the additive step.
- **Palette-row shifting** is the simplest form: the palette is one row dark-to-light, and "Darker" is 0 0 1 2, "Brighter" is 1 2 3 3: "The way this works is by shifting the palette." ([MPStudios devlog, Jan 2022](https://mpstudios-old.itch.io/schools-out-remake-tbn/devlog/335602/lighting-added-to-the-shaders))
- **Ramp step by light distance**: "The lighting engine, will determine what color in the ramp to use based on the distance the light is away from the voxel"; shadows are two steps down the ramp, clamped at the end. ([PixaVoxet devlog, Feb 2019](https://doublebody.itch.io/pixavoxet/devlog/67738/v107a-indexed-color-lighting))
- **Palette snapping as a post-pass** (combine with any lighting): a loop over the palette picking the nearest colour ([godotshaders "Palette shader (lospec compatible)", Aug 2021, CC0](https://godotshaders.com/shader/palette-shader-lospec-compatible/)). Our `nearest()` in `viewer/primitives.ts` does this in Oklab.
- **The constraint is a design rule, not a runtime trick.** Shovel Knight stayed inside a 54-colour NES palette and added four "cheater" colours purely as shading bridges: dark purple `#22123B` "as a bridge between black and the cooler colors", dark red `#360900` bridging "the gap from black to our warmer colors", because "the darker spectrum of color is very underrepresented." ([Yacht Club Games, "Breaking the NES", 2014](https://www.yachtclubgames.com/blog/breaking-the-nes/)) The lesson for us: a Palette meant to be lit needs a dark step on every ramp. Ours have four steps per ramp; whether the bottom step is dark enough for a night pass is a thing to check per Palette.

What it needs here:

1. **A colour-index plane.** The compositor writes RGBA and `glow` recovers the index with a reverse `Map` (`indexAt`). A ramp pass over the whole frame should instead keep a `Uint8Array` of Palette indices beside the RGBA frame, written by `blit`, `fill` and `overlay`. Element pixels are already Palette colours (Quality gate), so the index is known at load.
2. **Ramp metadata in the Palette.** Today a Palette is a flat list of 16 colours whose order happens to be four ramps of four. The ramp pass needs that structure stated: for each colour, its ramp and position, plus an emissive flag. That is a schema addition, not a Palette edit, so ADR 0001 holds.
3. **A light-level field.** `Uint8Array(SCENE_WIDTH * SCENE_HEIGHT)` holding a level per pixel: the Scene's ambient level (time of day) plus each light's falloff, clamped. Lights are static or flicker at `PROP_FPS` (10 fps), so the field is cached per flicker state the same way `glow` caches its `groups`.
4. **The pass**: `out[i] = rgba[lut[index[i] * levels + level[i]]]`.

## Light maps and additive overlays

The additive light sprite is the engines' default (Godot's Add mode; Phaser's sum of lights; Unity's Additive blend style) and the cheapest thing a GPU does. Celeste draws every light as a smooth gradient at its 320x180 internal size: "Our screen resolution is tiny (320x180)"; it packs them into "a grid, on a single texture" with one light per colour channel and "a shader that draws the light's color, but multiplied by the mask of the channel" ([Berry, 2017](https://noelberry.ca/posts/celeste_lighting/)). The light leaves the palette, but at Scene resolution it stays pixel-aligned, which is why Celeste and Hyper Light Drifter still read as pixel art.

Our `glow` Primitive is the palette-true version of this: additive light colour at four ring alphas (`GLOW_DISCS`), summed with the colour under it, then snapped to the nearest Palette colour through a LUT, with flicker levels that snap to the same colours sharing one cached state so `tick` skips them. The only thing it lacks for a general "light map" is a way to express a light that is not anchored to a Placement and a Scene-wide ambient level.

## Pixel-true glows and halos

Two ways to keep a halo from reading as a smooth airbrush over the pixels:

- **Band the falloff, then dither the bands.** The Godot "2D Retro Dithered Lighting & Fog-of-War" shader (nachomakesgames, June 2026, MIT) quantises the light to `dither_levels` (default 6) with a Bayer matrix: `float banded = clamp(floor(lit * dither_levels + bayer) / dither_levels, 0.0, 1.0);` where `bayer2(a) = fract(a.x * 0.5 + a.y * a.y * 0.75)` and `bayer4`, `bayer8` recurse on it ([godotshaders](https://godotshaders.com/shader/2d-retro-dithered-lighting-fog-of-war/), demo [schweller/godot4-retro-lighting-demo](https://github.com/schweller/godot4-retro-lighting-demo)). It then multiplies the scene by the band, so its output is not palette-constrained on its own; pair it with the ramp lookup or a palette snap.
- **Snap to the Palette after adding.** What `glow` does today. Adding a 2x2 Bayer threshold to the level before the snap buys one intermediate step per ring at no cost; whether that looks better or noisier at 192x120 is a visual judgement for a prototype.

Ordered dither to an arbitrary palette is Yliluoma's algorithm ([bisqwit.iki.fi](https://bisqwit.iki.fi/story/howto/dither/jy/)); the page refused connections on 2026-10-24, so its text is unverified here. `docs/research/pixel-art-quantisation.md` covers quantisation in more depth.

## Day-night cycles by palette remap

The historic precedent is colour cycling: a fixed index map whose palette entries change. Joseph Huckaby's "Old School Color Cycling with HTML5" (July 2010) is "an implementation of a full 8-bit color cycling engine, rendered into a 32-bit HTML5 Canvas in real-time" ([Google Experiments](https://experiments.withgoogle.com/canvas-cycle)); the code is MIT ([jhuckaby/canvascycle](https://github.com/jhuckaby/canvascycle)). Two details carry over to us:

- It tracks only the pixels whose palette entries animate and redraws those, "as opposed to walking through and drawing 307,200 pixels per frame" (README). Our `glow` does the same with its `slotPixel` list.
- Huckaby's "worlds" demo ([effectgames.com/demos/worlds](http://www.effectgames.com/demos/worlds/)) has a TIME OF DAY control in three-hour steps and a BlendShift mode that fades between palettes. That is time of day as palette selection plus interpolation, on Mark Ferrari's single-palette scenes. Whether Ferrari's GDC 2016 talk "8 Bit & '8 Bitish' Graphics - Outside the Box" demonstrates the day-night variant is unverified (talk title via [Wikipedia](https://en.wikipedia.org/wiki/Color_cycling)).

The modern shortcut is a multiply tint (Godot's `CanvasModulate` interpolated by clock time, as in the Usagi Shima devlog, [Apr 2021](https://usagishima.net/2021/04/13/devlog-2-real-time-day-night-cycle/)), which leaves the palette. For us the palette-true forms are:

1. **Ambient level offset**: the ramp pass with a Scene-wide level of, say, -1 at dusk and -2 at night. Free once ramp lighting exists, but a 4-step ramp gives only two usable night steps before everything is the darkest colour.
2. **Companion Palette**: a second Palette file (`cosy-night` beside `golden-hour`) with the same ramp layout, and the Scene's index plane rendered through it. Under ADR 0001 this is a new Palette, never an edit. Interpolating between the two in Oklab and snapping to whichever Palette is nearer gives Huckaby's BlendShift without leaving either palette. The Director would need to keep Element colour indices stable across the pair, which the Quality gate can check.

Noio's Kingdom is often cited for palette day-night; its devlog host no longer resolves and no primary source was found (unverified).

## Normal-mapped sprites

### What the tools produce

- **Sprite Lamp** (Snake Hill Games, Steam 25 Sep 2014, still listed): "the artist painting an object lit from several directions, images called 'lighting profiles', and then processing them into normal maps, depth maps, ambient occlusion maps"; "between two and five" profiles; shaders "included in Sprite Lamp in GLSL form, fully commented"; the site says "Sprite Lamp works well with pixel art". ([Steam](https://store.steampowered.com/app/316830/Sprite_Lamp/), [snakehillgames.com](http://www.snakehillgames.com/spritelamp/)) Hand-painted profiles per Element is more art than our pipeline has.
- **Sprite DLight** (Dennis Faas, 2014) "generates normal maps for 2D sprites, only by processing existing sprites"; the author conceded a perfect normal map from one sprite isn't possible ([html5gamedevs, Dec 2014](https://html5gamedevs.com/topic/10950-dynamic-lighting-with-normal-maps-of-sprite-dlight)). Its site was unreachable on 2026-10-24; availability unverified.
- **Laigter** (azagaya, GPL-3.0) "automatically generates maps for dynamic lighting effects in games" (normal, parallax, specular, occlusion) and has a headless CLI: `-g, --no-gui`, `-d, --diffuse <path>`, `-n, --normal`, `-r, --preset <path>` ([README](https://github.com/azagaya/laigter)). This is the one scriptable option for `pipeline/`.
- Research: "Analysis and Compilation of Normal Map Generation Techniques for Pixel Art" (SBGames 2022, [arXiv](https://arxiv.org/abs/2212.09692)) finds 3D-oriented methods "may not yield correct results due to the style specificities"; "Light the Sprite" (Eurographics 2025, [paper](https://diglib.eg.org/handle/10.2312/egs20251032), [code](https://github.com/IvanNik17/light-sprite)) generates light maps from a sprite and a light vector with a UNet. Neither is a service.

### Can PixelLab or Retro Diffusion make one?

No. Fetched 2026-10-24:

- **PixelLab** ([live OpenAPI spec](https://api.pixellab.ai/v1/openapi.json)): endpoints `/generate-image-pixflux`, `/generate-image-bitforge`, `/animate-with-skeleton`, `/animate-with-text`, `/rotate`, `/inpaint`, `/estimate-skeleton`, `/balance`. The `shading` enum is a style density, "flat shading" to "highly detailed shading", described as "Shading style reference (weakly guiding)"; `direction` is the subject's facing (eight compass points); `view` is "side", "low top-down", "high top-down". A search of the whole spec for "normal", "light", "emission" and "emissive" finds nothing. The docs nav lists an "Image to image (depth)" tool whose page returned only marketing text (unverified).
- **Retro Diffusion** ([api-examples README](https://github.com/Retro-Diffusion/api-examples); `docs.retrodiffusion.ai` does not resolve): `prompt_style` families `rd_pro__*`, `rd_plus__*`, `rd_fast__*`, `rd_mini__*`, `rd_advanced_animation__*`, `rd_animation__*`, `rd_tile__*`; parameters `remove_bg`, `tile_x`, `tile_y`, `seed`, `input_palette` ("Constrain output colors to a palette image."), `input_image` and `strength`; edit tools `image_edit`, `inpainting`, `outpainting`, `seam_tiling`, `background_remover`, `color_style_transfer`, `color_reducer`, `palette_converter`, `k_centroid_downscale`, `pixel_correction`, `rotate`. No line mentions normal, light, emissive or shading. The only indirect route is the Low-Poly 3D endpoint, which returns a mesh (export format unverified).
- The general-model fallback, ControlNet 1.1 `normalbae`, estimates normals from a photo-scale image ("blue is front, red is left, green is top"; [ControlNet-v1-1 README](https://github.com/lllyasviel/ControlNet-v1-1-nightly)); a 48-pixel Element would need upscaling and would get smooth normals, which is the failure mode below.

### How it looks on pixel art

A full-scale normal map "outputs very high res lit object, which looks smooth" because of too "many tones in the color pallete"; the fixes offered are "use a reduced color pallete for normal map" and "polish your normal maps, preferrably all by your hand!" ([Pawel, Defold forum, May 2022](https://forum.defold.com/t/normal-map-lighting-for-2d-pixel-art-sprites/70967)). The same thread notes baked shading breaks on `flipX`: "When sprite is flipped to go left, the shading is still static", which applies to our Placements that flip. The "plastic" critique is a 3D-shader complaint and no pixel-art source using the word was found (unverified).

**Verdict for this project**: the light direction in a Scene is fixed, so the Director should name it in each Brief and let the service shade the Element once. A normal map would buy a moving light we do not have, at the cost of a Laigter step, a second PNG per Element and a visual quality the community rates below hand shading.

## Cost: Canvas 2D per-pixel pass versus a WebGL fragment shader

### What the Viewer does today

The Viewer is already a software renderer. `createCompositor` writes every pixel into a `Uint8ClampedArray` and `viewer/scene.ts` uploads it once per tick with `ctx.putImageData(image, 0, 0)` on an `alpha: false` canvas at 192x120. `startLoop` (`viewer/loop.ts`) draws only when `compositor.tick()` reports a changed state and sleeps until `nextTick()`, so a static Scene costs nothing and a flickering lamp costs ten frames a second (`PROP_FPS`). Measured full `render()` cost per frame on this machine: 0.174 ms for `penthouse-rain-city-night-1x66` (3 Primitives, 1 glow) and 0.358 ms for `tree-house-golden-hour-x1z5` (6 Primitives, 2 glow).

### Measured per-pixel pass (Node 22, Apple M4, median of 2000 frames after warm-up)

| Pass | 192x120 (23,040 px) | 384x240 (92,160 px) |
| --- | --- | --- |
| Ramp LUT remap, `out[i] = rgba[lut[index[i] * 8 + level[i]]]` | 0.011 ms | 0.117 ms |
| One point light, quadratic falloff quantised to 8 levels | 0.019 ms | 0.127 ms |
| Smooth additive RGB halo over the frame, float maths, no snap | 0.036 ms | 0.204 ms |

Browser JIT speed is within a small factor of Node's (same V8 in Chrome; JavaScriptCore and SpiderMonkey comparable for typed-array loops). An older Intel laptop is roughly three times slower than an M4 on this kind of loop; the estimate below triples the numbers for it.

### Estimate for a day on battery

Take the pessimistic case the ticket asks about: 384x240, 24 fps, every frame redrawn, three lights plus the ramp remap plus one additive halo. That is about 0.5 ms per frame on the M4, 1.5 ms on an older laptop.

- Per second: 12 ms (M4) to 36 ms (old) of one core, 1.2% to 3.6% of a core.
- Eight hours: 24 x 3600 x 8 = 691,200 frames, so 5.8 minutes (M4) to 17 minutes (old) of single-core CPU time in total.
- `putImageData` upload: 384 x 240 x 4 = 368 KB per frame, 8.8 MB/s at 24 fps. Trivial against memory bandwidth; MDN's `putImageData` page carries no performance warning ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/putImageData)). The one Canvas 2D thing to keep avoiding is readback: `willReadFrequently` "will force the use of a software (instead of hardware accelerated) 2D canvas" ([MDN getContext](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext)), and the compositor never reads back because it owns the buffer.

At the real 192x120 the numbers divide by four, and `tick` skipping means a Scene whose lights are steady redraws only for weather and Frame strips. The lighting pass is not where the battery goes; the frame loop is, and `docs/research/browser-rendering.md` already covers that.

### What WebGL would change

- **Arithmetic**: 92,160 fragments of a ten-line shader is far below what any laptop GPU notices. The per-pixel maths would be free.
- **Fixed costs stay**: a rAF wake per frame, a `texImage2D` upload of the composited frame (same 368 KB, and MDN warns uploads mid-draw cause pipeline flushes: "Most texture uploads from DOM elements will incur a processing pass that will temporarily switch GL Programs internally, causing a pipeline flush" ([WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices))), and the browser compositor's own GPU pass, which runs for a Canvas 2D element too: "WebKit on macOS and iOS uses the GPU for painting, and so triggering painting can cause significant increases in power" ([WebKit, 2019](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/)).
- **New costs**: a `powerPreference` choice, where `"low-power"` "Prioritizes power saving over rendering performance" ([MDN getContext](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext)) and WebKit says to request the discrete GPU "only [...] if you can justify the power cost" ([WebKit, 2019](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/)); context loss, since "power events on mobile devices may cause the WebGL rendering context to be lost at any time" and resources created before a restore "are no longer valid" ([WebGL 1.0 spec](https://registry.khronos.org/webgl/specs/latest/1.0/)); `mediump` precision caveats; and a second implementation of every lighting rule for the Node Poster, because `sharp` has no GPU.
- **When it wins**: only if the light field were computed at display resolution (a 1920x1200 fullscreen canvas is 2.3 million pixels, 25 times the 384x240 case, and 25 x 0.5 ms = 12 ms per frame would be too much for JavaScript). That means sub-Scene-pixel gradients, which is the smooth look this project rejected when it fixed the canvas at 192x120.

**Conclusion**: at Scene resolution, a JavaScript per-pixel pass inside the existing compositor is the cheaper option in CPU, code and parity with the Poster. Keep the `browser-rendering.md` note that WebGL remains the escape hatch, but the trigger is display-resolution effects, not lighting as such.

## What a prototype should settle

1. Does a 4-step ramp give enough night? Render `golden-hour` with ambient -1 and -2 and judge. If not, the fix is a 5- or 6-step ramp in new Palettes, not a smarter pass.
2. Bayer-dithered levels versus hard snapping on the `glow` halo at 192x120: side-by-side 8x upscales in `scratch/`.
3. Companion-Palette blend: interpolate `golden-hour` to a night Palette in Oklab over sixty seconds, snap each frame, and check whether colour indices stay stable so no Element "pops".
4. Measure, in Chrome's Performance panel, the frame cost of the full pass in the real Viewer (not Node) on the slowest laptop to hand, with the lamp flickering at 10 fps.

## Sources not reached or not confirmed

- Hyper Light Drifter, Eastward and The Last Night: no developer write-up on their lighting was found; community descriptions only.
- Noio's Kingdom devlog (`kingdom.noio.nl`) no longer resolves.
- Yliluoma's dithering article refused connections.
- Sprite DLight's current availability; Unity 6 manual pages `2DRendererData_overview` and `LightBlendStyles` return 404 (the 16.0.6 package pages were used instead).
- PixelLab's "Image to image (depth)" tool page returned marketing text only.
