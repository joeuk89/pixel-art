# Turning generated images into clean pixel art in TypeScript

Research for issue #3, checked 2026-10-23. Answers: how a TypeScript (Node) pipeline turns a generated Element image into true pixel art at the house pixel density, with a transparent background, clean alpha edges, a fixed per-Scene palette and no dithering; which libraries do each step; and where a Python step would be justified.

## Recommendation in one paragraph

Use sharp (0.35.5, published 2026-09-27, Node >= 20.9) for decoding, trimming, alpha-premultiplied resizing, nearest-neighbour upscaling and PNG encoding. Do the three pixel-art-specific steps yourself on raw RGBA buffers from `sharp(...).raw().toBuffer()`: grid detection and per-cell colouring (snapping to the house density), binary alpha thresholding, and nearest-colour mapping to the fixed Scene palette. Each is under 100 lines of TypeScript over a `Uint8Array`, and no Node library does them as a unit. No Python step is needed for the stated requirements. The one place Python could still earn its place is background removal, if the generator cannot return transparency and the Node ONNX route proves too heavy; that is a prototype question, not a settled need.

## Verified facts about sharp and libvips (primary sources)

- sharp premultiplies alpha before resize, blur, convolve or sharpen and unpremultiplies afterwards: `shouldPremultiplyAlpha = image.has_alpha() && (shouldResize || shouldBlur || shouldConv || shouldSharpen)` in `src/pipeline.cc` (main branch, read 2026-10-23). `info.premultiplied` reports it. So sharp's own resize does not produce dark halo fringes from averaging the RGB of transparent pixels. libvips' `vips_resize` itself does not premultiply ("This operation does not premultiply alpha. If your image has an alpha channel, you should use vips_premultiply() on it first", resize.c doc comment); sharp does that for you.
- `resize({ kernel })` offers `nearest`, `linear`, `cubic`, `mitchell`, `lanczos2`, `lanczos3` (default), `mks2013`, `mks2021` (sharp api-resize; libvips `VipsKernel` enum).
- With `kernel: 'nearest'`, libvips `vips_resize` downsizes by point sampling (`vips_subsample`) for the integer part of the factor, then `vips_reduce` with the nearest kernel for any residual (resize.c lines 167-230). It is not a box average. With any other kernel, libvips box-shrinks (`vips_shrink`, "a simple box filter") by the integer part above `gap` (default 2.0) and then reduces with the chosen kernel. So sharp cannot be asked for an exact N x N box average or a per-cell mode; do that on the raw buffer.
- Integer nearest-neighbour enlargement is a fast `vips_zoom` (resize.c lines 257-266). `sharp(png).resize(w * 8, h * 8, { kernel: 'nearest' })` is the right call for Viewer-ready or preview upscales.
- `.trim({ background, threshold, lineArt, margin })` on an RGBA image searches the alpha channel as well as the colour channels and takes the union bounding box (`sharp::Trim` in `src/operations.cc`). Default background is the top-left pixel; default threshold 10. `info.trimOffsetLeft/Top` report the shift. libvips `find_trim` median-filters unless `line_art` is set; set `lineArt: true` for pixel art so single-pixel details are not trimmed away.
- `.png({ palette: true, colours: N, dither: 0, effort })` quantises with libimagequant inside libvips. The documented options are `palette`, `quality`, `effort`, `colours/colors`, `dither` (Floyd-Steinberg level, default 1.0). There is no option to pass a fixed palette (sharp api-output). It is fine for compressing a final PNG but not for mapping to the Scene palette.
- `.threshold(n)` converts to single-channel greyscale by default; to binarise only alpha, use `extractChannel('alpha').threshold(128)` then `joinChannel` back, or do it on the raw buffer.
- `.flatten({ background })` composites alpha onto a colour and drops alpha; `.ensureAlpha()`, `.removeAlpha()`, `.extractChannel()`, `.joinChannel()` exist (sharp api-channel).

## Recommended pipeline, step by step

Input: a generated Element image (typically 1024 x 1024 PNG) that looks like pixel art but is blurry, off-grid and over-coloured. Output: `element.png` at the house density with binary alpha and only Scene-palette colours, plus a `meta.json` with the grid scale found.

1. Ask the generator for transparency first. OpenAI's image API documents `background: "transparent"` with `output_format: "png"` or `"webp"` (developers.openai.com image-generation guide, read 2026-10-23; the models listed there are `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare`; sizes 1024x1024, 1536x1024, 1024x1536 or any multiple of 16 up to 3840). A native alpha channel removes the hardest step. Still run step 3, because generator alpha is soft.
2. Background removal only if the image arrives opaque. Candidate: `@imgly/background-removal-node` (1.4.5, published 2026-09-22, runs ONNX models on `onnxruntime-node` 1.30.0; licence "SEE LICENSE IN LICENSE.md", so read it before relying on it). Python `rembg` is the fallback. Not verified in this pass: model quality on flat-colour pixel-art-style images, which tends to be easier than photos. Treat this as the prototype's first test.
3. Alpha to binary. Pixel art has no semi-transparent edge pixels. Either threshold the matte per source pixel (alpha >= 128 is opaque) before downscaling, or threshold per-cell coverage after step 5 (a cell is opaque if more than half its source pixels are). The second is better: it votes over the whole cell and the edge lands on the grid. Never let transparent pixels vote for a cell's colour.
4. Detect the pixel grid. The generator's apparent pixels are not an exact divisor of 1024, and the phase is off by a few pixels. Estimate scale s and offset (ox, oy) by scoring candidate (s, ox, oy) on within-cell colour variance (lower is better), with s in a range around the expected value (for 1024 px asked as 128 x 128 art, s is near 8) and offsets 0..s-1. A cheaper estimator: the histogram of horizontal and vertical run lengths between colour changes peaks at s. Plain TypeScript on the raw buffer. If the best score is poor, reject the Element and regenerate rather than guess.
5. Downscale by the detected grid. For each cell take the mode (most frequent colour after a coarse 5-bit-per-channel bucket) or the centre sample; average only as a last resort, because averaging across a cell edge produces muddy intermediate colours that then quantise to the wrong palette entry. Do this in TypeScript; sharp's resize cannot do mode sampling, and its `nearest` path point-samples at a fixed phase.
6. Map to the fixed Scene palette with no dithering. Load the palette (a Lospec palette is available as `https://lospec.com/palette-list/<slug>.json` with a `colors` array of hex strings). Convert palette and cell colours to a perceptual space (Oklab or CIELAB via `culori` 4.0.2) and pick the nearest by Euclidean distance; keep transparent cells transparent. `image-q` 4.0.0 (last published 2022-06-19, MIT) can do this via its `NearestColor` image quantizer and a hand-built palette, and offers CIEDE2000, CIE94 and other distance formulas, but it is unmaintained and its alpha handling was not verified in this pass; a 30-line nearest-colour loop is easier to own. If a Scene palette ever needs to be built from several Elements, `image-q`'s WuQuant or RGBQuant palette builders fit.
7. Trim and pad. `sharp(raw, { raw: { width, height, channels: 4 } }).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0, lineArt: true })`. Trimming after snapping keeps the grid phase intact. Record `trimOffsetLeft/Top` if the Scene plan needs the Element's anchor.
8. Encode and check. `.png({ compressionLevel: 9 })` for the library master. `.png({ palette: true, colours: paletteSize + 1, dither: 0 })` is safe only after step 6, because libimagequant then has no colours to invent; the +1 is the transparent entry. Run a checker: every alpha is 0 or 255, every opaque colour is in the palette, and dimensions are multiples of the house density if the Element is stored upscaled.
9. Upscale for display only with `kernel: 'nearest'` and integer factors.

## Known failure modes and the step that prevents each

- Halo pixels at alpha edges: a dark or light fringe from resizing straight (non-premultiplied) RGBA, or from soft generator alpha mapped to a semi-opaque colour. sharp premultiplies during resize (verified above) and step 3 binarises alpha, so the remaining source is step 5 letting transparent pixels vote. Exclude them.
- Banding and posterisation after quantisation: with dithering off, smooth gradients collapse into flat bands. In pixel art this is intended and is managed by the palette, not the mapper: 16 to 32 colours built as hue-shifted ramps, and prompts that ask for flat colours and limited shading. Nearest-colour in Oklab or CIELAB reduces the wrong-hue picks that sRGB Euclidean distance gives.
- Off-grid pixels from the generator: a wrong scale or phase produces doubled columns, lost 1-px lines and shimmer when animated. Step 4 estimates both, uses integer scale only, and regenerates below a confidence threshold.
- Trim shifting the grid: trimming before snapping moves the phase by the trimmed amount. Trim after snapping (step 7).
- libimagequant choosing its own palette: `sharp.png({ palette: true })` picks colours and cannot be given the Scene palette. Use it only after step 6.
- Semi-transparent anti-aliasing from the generator surviving into the Element library: binary alpha (step 3) and the checker (step 8).

## Is a Python step justified?

Not for downscaling, quantisation or trimming. Pillow's `Image.quantize(palette=..., dither=Image.Dither.NONE)` can quantise to a fixed palette, but its MEDIANCUT and MAXCOVERAGE methods do not support RGBA (Pillow docs, read 2026-10-23), and nearest-colour mapping is trivial in TypeScript anyway. Background removal is the only candidate, and only if the generator cannot supply transparency and `@imgly/background-removal-node` (or `onnxruntime-node` with a public ISNet/U2Net model) proves unworkable in the prototype.

## Coverage note

The sharp, libvips, Pillow, OpenAI and Lospec facts above were checked against the primary sources listed. Three sub-investigations (background-removal libraries, quantisation libraries, grid-detection tools) were started but had not reported when this file was written, so the `@imgly/background-removal-node` and `image-q` entries rest on npm metadata and README reads only. A later pass should confirm their alpha handling and licences before the prototype commits to them.

## What a prototype should test

1. Does the chosen generator's transparent output have clean edges once alpha is thresholded, or does it leave a 1-2 px matte of background colour that needs an erode step?
2. Grid detection accuracy across 20 generated Elements: how often is the detected scale the intended one, and how often is confidence low enough to force a regenerate?
3. Mode versus centre-sample per cell on the same Elements, judged by eye at 8x.
4. Oklab versus sRGB nearest-colour on a 32-colour Scene palette: count the visibly wrong hue picks.
5. `@imgly/background-removal-node` on opaque generations: time per image, model download size, licence terms.

## Sources

- sharp resize docs: https://sharp.pixelplumbing.com/api-resize
- sharp output docs (png options): https://sharp.pixelplumbing.com/api-output
- sharp channel docs: https://sharp.pixelplumbing.com/api-channel
- sharp operation docs: https://sharp.pixelplumbing.com/api-operation
- sharp composite docs: https://sharp.pixelplumbing.com/api-composite
- sharp changelog v0.35.5 (2026-09-27): https://sharp.pixelplumbing.com/changelog/v0.35.5
- sharp source, premultiply and resize: https://github.com/lovell/sharp/blob/main/src/pipeline.cc
- sharp source, trim: https://github.com/lovell/sharp/blob/main/src/operations.cc
- libvips resize source and doc comment: https://github.com/libvips/libvips/blob/master/libvips/resample/resize.c
- libvips shrink: https://www.libvips.org/API/current/method.Image.shrink.html
- libvips reduce: https://www.libvips.org/API/current/method.Image.reduce.html
- libvips premultiply: https://www.libvips.org/API/current/method.Image.premultiply.html
- libvips find_trim: https://www.libvips.org/API/current/method.Image.find_trim.html
- libvips Kernel enum: https://www.libvips.org/API/current/enum.Kernel.html
- image-q README: https://github.com/ibezkrovnyi/image-quantization
- Pillow Image.quantize: https://pillow.readthedocs.io/en/stable/reference/Image.html#PIL.Image.Image.quantize
- OpenAI image generation guide: https://developers.openai.com/api/docs/guides/image-generation
- Lospec palette API: https://lospec.com/palettes/api
- npm versions via `npm view` on 2026-10-23: sharp 0.35.5, image-q 4.0.0, @imgly/background-removal-node 1.4.5, onnxruntime-node 1.30.0, culori 4.0.2, quantize 1.0.2, rgbquant 1.1.2, @thi.ng/pixel 7.5.38
