# Research: image services for larger canvases, outpainting and seamless backdrops

Resolves [issue #63](https://github.com/joeuk89/pixel-art/issues/63), part of the v2 map ([#61](https://github.com/joeuk89/pixel-art/issues/61)). Researched 2026-10-24. Updates [image-generation-services.md](image-generation-services.md) (2026-10-23), which stays the record for per-call USD prices, terms and the services ruled out for v1. Every fact below was read from an official page on 2026-10-24 unless marked otherwise. Prices are USD. "Generations" are PixelLab subscription units; Tier 1 gives 2,000 a month.

## Answer in brief

- **A 384x240 backdrop in one call is possible today**, but never with both a style image and a 1-generation price. PixelLab: Pixflux (1 generation, about $0.01, `color_image` palette, no style image) or Pro `generate-image-v2` (probably 25 generations or $0.15, `style_image` and `target_palette`). Retro Diffusion: RD Fast $0.03 or RD Plus $0.06 flat at up to 384 px per side with `input_palette`, no reference images (RD Pro, the reference-image model, stops at 256). PixelLab Pro Flash stays capped at **256 px per axis**, so the v1 model cannot draw a 320- or 384-wide backdrop in one call.
- **Outpainting**: Retro Diffusion has a real `outpainting` edit tool ($0.18, `expand_left/right/top/bottom`), without palette or reference input. PixelLab has none; its route is inpainting on a padded canvas: `inpaint-v3` (32 to 512 px per side, Tier 1 capped at 256, 10 generations) or `inpaint-image-pro-flash` (32 to 256 per side, 5 to 9 generations) fill white mask pixels and leave the rest byte-identical. The plugin-only "Extend map" tool is not in the API.
- **Overlapping strips are a pipeline pattern on both services, not a feature.** Generate strip 1 with the Style anchor, then each next strip as an inpaint or outpaint whose preserved region is the overlap. No inpaint or outpaint endpoint on either service takes a style image or a palette lock, so the extended region keeps the look only through the preserved overlap and is re-palettised afterwards (PixelLab: the pipeline's quantiser; Retro Diffusion: free `palette_converter`). A 384x240 backdrop costs about 15 generations as two Pro Flash strips, about 25 as one Pro call, $0.36 as a Pro strip plus one outpaint on Retro Diffusion, or $0.06 as one RD Plus call.
- **Seamless tiles**: Retro Diffusion's `tile_x`/`tile_y` flags make any generation seamless on either axis at no extra cost, and `seam_tiling` ($0.18) fixes an existing image. PixelLab has only Wang-set tile endpoints (`create-tileset` 16/32/64 px tiles for 3 generations; `create-tiles-pro` 16 to 128 px for 10 to 25), all with a palette and most with reference or style images; nothing makes a single wide seamless texture (the plugin's "Create texture" tool is not in the API).
- **Palette lock and style image**: PixelLab's Pro and Pro Flash *creation* endpoints take `target_palette` (2 to 256 hex colours, every output pixel is on it) and a `style_image`; its inpaint endpoints take neither. Retro Diffusion's `input_palette` works on every generation style including tiled ones; `reference_images` (up to 9) only on RD Pro, up to 256 px.
- **v1 facts checked**: Pro Flash custom size is 16 to 256 px per axis in 4 px steps (unchanged); it charges 5 generations at 32 and 64 px, 6 at 128 px and 9 at 256 px, so "5 to 9" is right and the v1 pipeline's measured 5 and 6 match the price table. Tier 1 is 2,000 generations a month (confirmed by `GET /v2/balance` in v1). The 8-concurrent-jobs cap is still what Tier 1 starts with, but PixelLab now runs a dynamic scheme with earned "priority slots" (details below).

## Canvas sizes above 128 px

Targets: the v2 candidates 384x240 and 320x180, plus 256x160 and 192x120 for comparison.

| Service / endpoint | Size rule (source) | 192x120 | 256x160 | 320x180 | 384x240 | Cost at 384x240 | Palette lock | Style image |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PixelLab Pixflux `create-image-pixflux` (or `-background`) | 16 to 400 per axis, area 32x32 to 400x400 ([spec](https://api.pixellab.ai/v2/openapi.json) `CreateImagePixfluxRequest.image_size`) | yes | yes | yes | yes | 1 generation; $0.0079 to $0.0132 ([pricing](https://www.pixellab.ai/pixellab-api)) | `color_image` (palette image) | no; `outline`/`shading`/`detail` enums and `init_image` only |
| PixelLab Pixen `create-image-pixen` | min side 16, max area 512x512, sides divisible by 4 (spec) | yes | yes | yes | yes | 1 generation; about $0.009 | **none** (no palette field) | no |
| PixelLab Pro Flash `create-image-pro-flash` | 16 to 256 per axis, multiples of 4; custom sizes beta (spec `ProFlashImageSize`) | yes | yes | **no** | **no** | n/a; 256x256 is 9 generations, $0.033 | `target_palette` hex | `style_image` + `style_options`; "style art must fit without rescaling" |
| PixelLab Pro `generate-image-v2` | 16 up to an aspect-ratio max: 512x512 at 1:1, 688x384 at 16:9; schema caps width 792, height 688 (spec; [docs](https://www.pixellab.ai/docs/tools/create-sl-image-pro)) | yes | yes | yes | yes | 1 image above 170 px; square price bands 171-256: 10 gen/$0.08, 257-341: 15/$0.115, 342-512: 25/$0.15. "Cost depends on total grid content size and varies with aspect ratio", so 384x240 is probably 25 generations but unverified | `target_palette` hex (set `style_options.color_palette=false`) | `style_image` + up to 4 `reference_images`; non-square references are padded to square |
| PixelLab Pro `generate-with-style-v2` | output is square, sized by the largest style image, 16 to 512 (spec) | no (square only) | no | no | no | same bands as Pro | no palette field | 1 to 4 style images |
| Retro Diffusion RD Fast / RD Plus `POST /v2/inferences` | 64 to 384 per axis, any aspect ([llms.txt](https://github.com/Retro-Diffusion/api-examples/blob/main/llms.txt)) | yes | yes | yes | yes | $0.03 / $0.06 flat | `input_palette` image | no (`input_image` + `strength` only) |
| Retro Diffusion RD Pro | 12 to 256 per axis | yes | yes | **no** | **no** | $0.18 flat | `input_palette` | up to 9 `reference_images`, or a custom style from one |

Notes:

- The free tier and Tier 1 caps in the plugin docs are per tool, not per API endpoint: "Create map (pixflux)" allows 320x320 area on Tier 1 and 400x400 on Tier 2 ([docs](https://www.pixellab.ai/docs/tools/create-map)); the API spec for `create-image-pixflux` states only the 400x400 area. If a 384x240 Pixflux call is rejected on Tier 1, that is why.
- Pixflux and Pixen are the v1 "cheap" models (1 generation); v1 chose Pro Flash for its style image. Pixflux at 384x240 is the only 1-generation backdrop route with a palette lock, at the price of no Style anchor.
- Pro Flash's `/pro-flash/capabilities` and `/pro-flash/cost` endpoints need a key (401 without one) and were not called; the spec says `create` costs "five image generation units provisionally; query /v2/pro-flash/cost for current pricing".

## Outpainting and extending an image

No service surveyed has an outpaint or extend endpoint. The available route everywhere is inpainting on a padded canvas.

**PixelLab `inpaint-image-pro-flash`** ([spec](https://api.pixellab.ai/v2/openapi.json)): "Replace only white mask pixels, preserving unmasked RGBA exactly." Source and mask must share "identical supported native dimensions", 32 to 256 px per side in 4 px steps ([pricing](https://www.pixellab.ai/pixellab-api)). Mask RGB must be pure black and white; empty masks are rejected. `output_method` returns the full composite or changes only. Optional `context_image` with its `bounding_box` gives the model more of the surrounding art than the canvas holds, which is exactly the overlapping-strip case. Price 5 generations at 32 and 64 px, 6 at 128, 9 at 256 ($0.023 to $0.041). **No `style_image` and no `target_palette`**; `no_background` and `background_removal_task` only.

**PixelLab `edit-image-pro-flash`**: text or `reference_image` edit of a whole canvas, "the source canvas never grows or resizes", 32 to 256 px per side, same price bands, plus a `use_color_palette_correction` boolean. Useful for restyling a strip, not for extending it.

**PixelLab `inpaint-v3` (Pro)**: 32x32 to 512x512 per side in the spec; the tool docs add "256 pixels per side on tier 1, and 512 per side on tier 2 and above. The limit is per side, not an area, so 512x64 and 512x512 are both fine on tier 2" and "Costs 10 generations per use" ([docs](https://www.pixellab.ai/docs/tools/inpaint-v3)); the price table lists 10/15/25 generations ($0.08/$0.115/$0.15) by the 256/341/512 bands. `crop_to_mask` defaults on. `context_image` and `bounding_box` are marked deprecated. No palette or style field.

**PixelLab `inpaint` (classic)**: max area 200x200, "forced palette" and `init_image` supported, 1 generation ($0.007 to $0.013). Too small for a v2 backdrop but the only inpainter with a palette lock.

**PixelLab `edit-images-v2` (Pro)**: 32 to 512 output, edits up to 16 frames consistently with `edit_with_reference`; 10 to 25 generations. A restyle tool, not an extender.

**Plugin-only tools not in the API**: "Extend map (v2)" (180x180 area, Tier 2, experimental) and "Inpaint M-L (pixpatch v2)" (180x180, Tier 2) appear in the Aseprite/Pixelorama docs ([extend-map-v2](https://www.pixellab.ai/docs/tools/extend-map-v2)) but have no path in `openapi.json`.

## A wide backdrop in overlapping strips

The services give the parts; the pipeline composes them. Two workable recipes on PixelLab, costed for a 384x240 backdrop:

1. **Pro Flash strips (about 15 generations)**. Strip 1: `create-image-pro-flash` at 256x240 with the Scene's `target_palette` and Style anchor as `style_image` (9 generations). Strip 2: paste the right 128 px of strip 1 on the left of a new 256x240 canvas, white-mask the right 128 px, call `inpaint-image-pro-flash` with the brief and strip 1 as `context_image` (9 generations at 256; 6 if the canvas is 128 wide). Quantise the new pixels to the Palette in the pipeline, because inpaint has no palette lock. Max canvas per call 256 px, so 384 needs two strips and 512 needs three.
2. **One Pro call (about 25 generations)**. `generate-image-v2` at 384x240 with `target_palette`, `style_image` and `reference_images`; one image, palette-locked by the service. Simpler, and the only one-call route with both locks, but 25 generations is five v1 props.

A Pixflux 384x240 call (1 generation, `color_image`) is the cheap control: palette-locked, no style image, so it is worth a prototype side by side with the anchor-locked routes before v2 commits to either.

Quality caveats from the docs: Pro Flash seeds are "recorded; the image provider does not promise deterministic output", so a failed strip is re-sent, not re-seeded (matches v1's #20 finding). Pro reference images "larger than 1024x1024 will be downscaled. Non-square images will be padded to square", so a 64x64 anchor is fine but a 2:1 strip passed as a style image is padded. Pro Flash style art "must fit without rescaling" (v1 saw this as the 422 `style image must fit`).

## Seamless tiles

| Endpoint | What it makes | Tile sizes | Cost | Palette | Style or reference |
| --- | --- | --- | --- | --- | --- |
| PixelLab `create-tileset` | 16-tile Wang corner set of two terrains (25 tiles at `transition_size` 1.0), "connect seamlessly" by construction; `mode: "pro"` is "richer painted" | 16 or 32 standard; 16/32/64 pro (experimental) (spec `TileSize`) | 3 generations, $0.0079 to $0.0099 ([pricing](https://www.pixellab.ai/pixellab-api)); docs say standard 1 to 4, pro 10 to 25 ([docs](https://www.pixellab.ai/docs/tools/create-tileset)) | `color_image`; `target_palette` hex pro only | `lower_/upper_/transition_reference_image`; `outline`/`shading`/`detail` enums |
| PixelLab `create-tileset-sidescroller` | platform tiles on transparent background, side view | 16 or 32 | 3 generations | `color_image` | reference images |
| PixelLab `create-tiles-pro` | independent tile variations, or connectable sets: `roads` (18), `tileset` (16-tile Wang, 32-tile hex coastline), `building` kit; `outline_mode: "segmentation"` "giving cleaner seamless edges" | 16 to 128 (32 recommended; connectable sets mostly top out at 96) | 10/15/25 generations by tile up to 42/56/85 px ($0.08/$0.115/$0.15) | `target_palette` hex, every pixel of every tile | `style_images` (tiles that set shape and style) + `style_options` |
| PixelLab `create-isometric-tile` | one isometric tile | 16 to 64 area | 1 generation | forced palette | init image |
| Retro Diffusion `tile_x` / `tile_y` on any image style | one seamless image, either or both axes | the style's range, up to 384 | the style's flat price | `input_palette` | RD Pro `reference_images` (up to 256 px) |
| Retro Diffusion `seam_tiling` edit tool | makes an existing image tileable (`seam_width`, `repair_window_size`) | not published | $0.18 | no | no |
| Retro Diffusion `rd_tile__*` styles | Wang tilesets, single tiles, variations, tile objects | 16 to 128 (tileset 16 to 32) | $0.06 to $0.10 | `input_palette` | `input_image` for variations |

For v2 the relevant case is a sky or texture that `tileX` repeats. Retro Diffusion answers it directly: one RD Plus call at 384x240 with `tile_x: true` and `input_palette` ($0.06). PixelLab's tile endpoints are game-map Wang sets (small, top-down or side platforms), not a single wide seamless texture, so on PixelLab a 384-wide sky band is one backdrop with the pipeline checking the left and right edges, or a Pro Flash strip whose last inpaint preserves the first strip's left edge as its right edge (the inpaint recipe above with the overlap taken from strip 1's start). The plugin's "Create texture" tool ("meant to be used in combination with the Create Tileset tool", Tier 1) has no API path.

## Palette lock and style image, per endpoint (PixelLab)

| Endpoint | `target_palette` (hex, every pixel on it) | Palette image (`color_image`) | `style_image` | Other consistency levers |
| --- | --- | --- | --- | --- |
| `create-image-pro-flash` | yes (2 to 256 colours, `max_colors` 2 to 64, `smart` beta) | no | yes, with `style_options` | `seed` (not deterministic) |
| `edit-image-pro-flash` | no; `use_color_palette_correction` flag only | no | `reference_image` (method `reference`) | source canvas kept |
| `inpaint-image-pro-flash` | **no** | no | **no**; `context_image` + `bounding_box` | preserves unmasked RGBA |
| `generate-image-v2` | yes | no | yes + 4 `reference_images` | `seed` |
| `generate-with-style-v2` | no | no | 1 to 4 style images (set size) | `style_description` |
| `inpaint-v3` | **no** | no | **no** (`context_image` deprecated) | `crop_to_mask` |
| `edit-images-v2` | no | no | `reference_image` | edits up to 16 frames together |
| `create-image-pixflux` | no | yes | no | `init_image` + strength, `outline`/`shading`/`detail` |
| `create-image-pixen` | **no** | **no** | no | `outline`, `detail`, `view` |
| `create-image-bitforge` | no | yes | yes + `style_strength` | max area 200x200 |
| `create-tileset` | pro mode only | yes | reference images per terrain | `outline`/`shading`/`detail` |
| `create-tiles-pro` | yes | no | `style_images` | `outline_mode` |

`TargetPalette` ([spec](https://api.pixellab.ai/v2/openapi.json)): "2 to 256 hex colours"; `max_colors` "At most this many colours in each image"; `smart` (beta, single images only) "put each object on the palette as a whole (a face stays skin-coloured, wood stays brown) instead of giving every pixel its nearest colour. Needs colors; adds about 15-60 s." That last option did not exist in the 2026-10-23 research and may help a backdrop keep sky colours in the sky.

## v1 facts verified or corrected (PixelLab)

| v1 statement | Verdict | Source |
| --- | --- | --- |
| Pro Flash custom size is 16 to 256 px per axis | **Correct.** `width`/`height` integer, `minimum 16`, `maximum 256`, `multipleOf 4`; "Custom size (Beta)". Native presets 16 (experimental), 24, 32, 32x48, 48, 64, 96x64, 96, 128 | spec `CreateImageProFlashRequest.image_size` |
| Pro Flash charges 5 to 9 generations for large canvases | **Correct, now precise.** Price table: 32x32 and 64x64 = 5 generations ($0.024), 128x128 = 6 ($0.029), 256x256 (Beta) = 9 ($0.033). Edit and inpaint Pro Flash: 5/5/6/9 ($0.023 to $0.041). The repo's Element records show 5 for longest side up to 80 px and 6 at 120 to 128 px, matching the table | [pricing page](https://www.pixellab.ai/pixellab-api) data (`generations` field in the page's price objects, shown by its Credits/Generations switch) |
| Tier 1 allows 2,000 generations a month | **Correct** as of 2026-10-23: `GET /v2/balance` returned `total: 2000` for the owner's Tier 1 plan (issue #21). The plans panel on pixellab.ai is client-rendered through Paddle and could not be read without a browser session today; the spec's `Subscription` schema example is `"total": 2000`, plan `"Tier 2: Pixel Artisan"`. Tier 1 is named "Pixel Apprentice" in the site scripts | spec `Subscription`; [#21](https://github.com/joeuk89/pixel-art/issues/21) |
| Tier 1 allows 8 in-flight jobs | **Correct as a starting limit, but the scheme is now dynamic.** v1 measured `429 Maximum 8 concurrent background jobs allowed (Tier 1)` (uncharged). The API page's account panel today reads "Free plan: 1 generation at a time", "Priority slots are concurrent jobs that skip added queue time. Run more jobs in parallel than your current slots for 30 minutes to earn one; they fade while idle", "idle 30 min → −1", and a `hard_cap` after which "contact us". The spec's 429 text is "Concurrent job limit reached". The pipeline's `MAX_JOBS = 8` with retry-on-429 remains the right shape; the cap may rise during a long run and fall back after | [pricing page](https://www.pixellab.ai/pixellab-api) script; spec; [#22](https://github.com/joeuk89/pixel-art/issues/22) |
| Pro (`generate-image-v2`) max 512 | **Updated.** 512x512 is the 1:1 cap; non-square goes to 688x384 at 16:9, schema caps 792x688. One image above 170 px | spec; [docs](https://www.pixellab.ai/docs/tools/create-sl-image-pro) |
| Pixflux area 32x32 to 400x400 | Correct; each axis also 16 to 400 in the schema. The plugin's Tier 1 cap is 320x320 area for "Create map (pixflux)" | spec; [docs](https://www.pixellab.ai/docs/tools/create-map) |

Changelog: PixelLab publishes no changelog page (`/changelog` redirects to the home page; `api.pixellab.ai/v2/changelog` is 404). The spec's `info.version` is `dev`. New since 2026-10-23 that matters here: `TargetPalette.smart`, `create-tiles-pro` connectable sets (`tile_feature`), `create-tileset` `mode: "pro"` with 64 px tiles, and the priority-slot concurrency panel.

## Retro Diffusion

Sources: the vendor's agent reference [llms.txt](https://github.com/Retro-Diffusion/api-examples/blob/main/llms.txt) (header "verified 2026-09") and [README](https://github.com/Retro-Diffusion/api-examples/blob/main/README.md) in the official `api-examples` repo, plus [09_edit_tools.py](https://github.com/Retro-Diffusion/api-examples/blob/main/example-scripts/09_edit_tools.py). The human guide at retrodiffusion.ai/app/guide/api and the public site are a client-rendered app that returns no readable text without a browser session, and `GET /v2/edit/tools` (the "authoritative" tool list with limits) needs a key, so it was not called. Retro Diffusion publishes no changelog page. The v1 pipeline (`pipeline/lib/retro-diffusion.ts`) already speaks this API's `/inferences` and task-polling shape; the reference now recommends base `https://api.retrodiffusion.ai/v2` ("V1 remains supported with no retirement plan").

**Canvas sizes.** `POST /v2/inferences` validates 12x12 to 512x512 overall, "but each style enforces tighter limits (current styles top out at 384x384)". Non-square is allowed (the guide suggests 256x144 for 16:9). Per style family:

| Family | Price (flat per image, any size) | Size range | Reference images | Fits 384x240 | Fits 320x180 |
| --- | --- | --- | --- | --- | --- |
| RD Fast (`rd_fast__default`, `__texture`, `__no_style`, ...) | $0.03 | 64 to 384 px | no | yes | yes |
| RD Plus (`rd_plus__default`, `__environment`, `__textured`, ...) | $0.06 | 64 to 384 px | no | yes | yes |
| RD Pro (`rd_pro__default`, `__painterly`, `__simple`, ...) | $0.18 | 12 to 256 px | up to 9 | **no** (256 cap; 256x160 fits) | no |
| `rd_tile__scene_object` | $0.06 | 64 to 384 px | no | yes | yes |

So a 384x240 backdrop is one $0.03 to $0.06 call on Fast or Plus, palette-locked by `input_palette`, but the style-reference model (Pro) stops at 256 per side. `check_cost: true` is a free dry run; `GET /v2/styles/selector` returns live `min_width`/`max_width` per style.

**Outpainting: a real endpoint.** `POST /v2/edit/tools/outpainting` ($0.18): `input_image` plus `expand_left`/`expand_right`/`expand_top`/`expand_bottom` "with at least one positive", optional `prompt`, `seed`, `soft_inpaint`. The example script expands by 32 px. `inpainting` ($0.18) takes a `mask_image` matching the input (RGBA alpha 0 protects, alpha over 12 edits; "With soft_inpaint=false, pixels outside the selected mask are restored exactly"). `image_edit` ($0.18, up to 256 px) restyles a whole image. Use the async form `POST /v2/edit/tools/{tool}/tasks` ("20-40 s"); results for these three tools come back only as hosted `output_urls`, not base64. The size limit for outpainting and inpainting inputs is not in the public reference; `GET /v2/edit/tools` lists "costs, defaults, and limits". **No palette or reference-image field on the edit tools**, so an outpainted strip is re-palettised with the free `palette_converter` tool (`input_palette`, dither options) or the pipeline's quantiser.

**Overlapping strips.** Two routes: (a) generate 384x240 in one Fast/Plus call and skip strips; (b) generate a 256-wide Pro strip with `reference_images` (the Style anchor) and `input_palette`, then `outpainting` with `expand_right` in 128 px steps at $0.18 each, then `palette_converter` (free). A 384x240 backdrop by route (b) is $0.36; by route (a) $0.06. Neither route carries the style reference into the outpainted region.

**Seamless tiles.** `tile_x` / `tile_y` booleans on `POST /v2/inferences` give "seamless tiling on either axis" for any image style at any size in range, so a 384x240 sky with `tile_x: true` is one $0.03 to $0.06 call, palette-locked, and on Pro (up to 256 wide) with reference images too. `POST /v2/edit/tools/seam_tiling` ($0.18; `tile_x`, `tile_y`, `seam_width`, `repair_window_size`, `seed`) makes an existing image tileable. Tileset styles: `rd_tile__tileset` and `__tileset_advanced` (16 to 32 px Wang tiles, $0.10), `rd_tile__single_tile` (16 to 64), `rd_tile__tile_variation` (16 to 128, input image required), `rd_tile__tile_object` (16 to 96), `rd_fast__texture`.

**Palette lock and style image.** `input_palette` (base64 palette image) "constrains output colors" on every generation style, and `return_pre_palette` returns the unquantised image too; v1 measured the result as on-palette within rounding (issue #11). Style image: `reference_images` (up to 9) on RD Pro styles only, which "guides style/content without redrawing"; custom styles (`POST /v2/styles`, exactly one reference image, optional `force_palette` and `force_bg_removal`, `min_width`/`min_height` 64 to 256) make a reusable `user__` style, still Pro-priced. `input_image` + `strength` is img2img on any style. `seed`: "Same seed + settings ≈ same image."

**Limits, billing, quality.** Balance is prepaid USD, "charged before generation, auto-refunded on failure"; `Idempotency-Key` header on paid submissions; v2 errors carry `code` and 429 is "rate limit" with `Retry-After`, no published numbers; Pixel Fixer is free at 10 requests a minute. Quality notes from the vendor's craft guide: name a flat contrasting background in the prompt when using `remove_bg`; "N independent generations of the 'same' scene come out as N unrelated compositions", so variants (dusk, rain) should be `image_edit` derivations of one base; `negative` is ignored by all current models; full scenes are recommended at 256 on Pro "for 16:9 use 256x144". Non-Pro styles have no style reference, so a 384-wide Fast/Plus backdrop can match the Scene's Palette but not its Style anchor.

## Newcomers with a pixel-art-native API

No new pixel-native service with a public API was found. What did turn up:

- **Retro Diffusion on Replicate** ([blog, 2025-11-19](https://replicate.com/blog/retro-diffusions-pixel-art-models-are-now-on-replicate); [rd-plus](https://replicate.com/retro-diffusion/rd-plus)): four models, `rd-fast`, `rd-plus`, `rd-tile` and `rd-animation`, "trained at a native pixel resolution of 256x256 or lower", with "arbitrary width/height", `tile_x`/`tile_y` seamless tiling, "Input palette for strict color adherence", background removal and `input_image` + `strength`. No RD Pro (so no reference images) and no edit tools (no outpainting). Per-run price and licence are not on the pages fetched today; Replicate bills official models per output image and public models by GPU second ([v1 research](image-generation-services.md)). Worth knowing as a second billing route to the same models, not a new capability.
- **Scenario** ([pricing](https://scenario.com/api-pricing)): API from $0.004 an image, priced by steps and dimensions from 512x512 up; its Pixelate tool (grids 16 to 256 px, custom palette) post-processes a high-resolution image. Not pixel-native.
- **Sorceress TileMaker** (vendor blog posts only): browser seamless-tile generation over general image models; no API found. Ruled out.
- fal.ai: no Retro Diffusion or other pixel-native listing surfaced in search; unverified rather than absent. The FLUX/SDXL pixel-art LoRAs there and on Replicate remain 1024-px "pixel look" models (see v1 research).

## What a prototype should test

1. **One-call 384x240 backdrop**, three ways: Pixflux with `color_image` (1 generation), Pro `generate-image-v2` with `target_palette` and the Style anchor (expected 25 generations; record the actual `usage.generations`), and RD Plus `rd_plus__environment` with `input_palette` ($0.06; `check_cost` first). Judge fullscreen against the penthouse's tiled 128x64 skyline, and judge whether the two unanchored results read as the same hand as the props.
2. **Two Pro Flash strips with inpaint** (recipe 1 above): does the seam at the 128 px overlap read, does the inpainted half keep the anchor's outline and shading without a style image, and how many colours leave the Palette before the quantiser. Compare with an RD Pro 256x240 strip plus one `outpainting` `expand_right: 128` ($0.36).
3. **Seamless sky**: RD Plus 384x240 with `tile_x: true` versus a PixelLab strip whose last inpaint preserves strip 1's left 32 px as its right edge; `tileX` both and look for the seam.
4. **`TargetPalette.smart`** on a backdrop versus nearest-colour mapping: does the sky stay sky-coloured.
5. **Concurrency**: run 12 jobs and log the 429s; see whether the cap rises after 30 minutes as the panel text says.

## Coverage note

Read today from primary sources: PixelLab `openapi.json` (all paths and the request schemas quoted), `llms.txt`, the API pricing page and its price data, the tool docs for Create S-XL image (Pro), Create images from style references (Pro), Inpaint v3, Edit image (Pro), Create tiles (Pro), Create tileset, Create map (pixflux), Extend map (v2), Inpaint M-L (pixpatch v2) and Create texture; Retro Diffusion's `llms.txt`, README and `09_edit_tools.py` in the official `api-examples` repo; Replicate's Retro Diffusion model pages and launch post; Scenario's pricing and Pixelate pages. No paid endpoint was called; PixelLab's `/pro-flash/capabilities` returned 401 without a key.

Not verified: the plan table (prices and generations per tier) on pixellab.ai, which loads client-side; the exact generation charge of a non-square Pro call such as 384x240 (the docs say cost "varies with aspect ratio"); Tier 2 and 3 concurrency limits under the new priority-slot scheme; Retro Diffusion's size limits for `outpainting`, `inpainting` and `seam_tiling` and its rate limits (behind the authenticated `GET /v2/edit/tools` and the login-only guide); Replicate's per-run price and licence for the Retro Diffusion models; whether fal.ai hosts any pixel-native model.
