# The Scene canvas is 384x240

This reverses an earlier decision that the canvas stays 192x120 and that higher resolutions were tried and rejected. At 192x120 a sofa has no room for shading and a skyline has no room for windows. The 384x240 rebuild of the penthouse on `prototype/resolution` (#71) showed the extra pixels buy shading, readable Backdrops and depth without breaking the rest of the design. Pro Flash still returned every image on the Palette with binary alpha. A frame with rain, lighting and a Halo took 3.8 ms in headless Chromium, against a 41 ms budget at 24 fps. On a 1920x1080 display the Viewer draws the canvas at an integer 4x. The same 16:10 shape keeps the letterbox and Share link previews as they were.

The schema holds the size as `SCENE_WIDTH` and `SCENE_HEIGHT`. The prop limits (16 to 256 px a side, a multiple of 4) and the Backdrop limit (up to the canvas size, a multiple of 4) follow from it. The Open Graph Poster stays 768x480, now a 2x upscale.

## Considered options

- Stay at 192x120: the cheapest per Element, but the penthouse showed every v1 limit at once, and the lighting and depth work in v2 need the pixels.
- 480x300 or larger: Pro Flash caps at 256 px per axis, so more Backdrops would need the slower, dearer services. Each prop costs more generations, and on common desktop displays the integer scale drops to 3x or lower.
