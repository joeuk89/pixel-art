# Research: pixel-art image generation services for Elements

Resolves [issue #2](https://github.com/joeuk89/pixel-art/issues/2). Researched 2026-10-23. Every price and feature below was read from an official page on that date unless marked otherwise. Prices are USD, as the services quote them.

Exchange rate used: £1 = $1.32 (early-October 2026 observed rate), so the £2 Scene ceiling is about **$2.60** and the £50 monthly ceiling about $66. A "Scene" below means 15 Elements, the middle of the 10 to 20 range; multiply by 1.33 for 20.

## Answer in brief

Two services generate pixel art at **true pixel resolution** (a 64x64 request returns a 64x64 PNG where one image pixel is one art pixel), with a transparent background and a palette constraint as request parameters: **Retro Diffusion** and **PixelLab**. Everything else surveyed (OpenAI, Google, Stability, and FLUX/SDXL pixel-art LoRAs on fal.ai and Replicate) renders a pixel *look* at 1024px or larger, so the pipeline would have to downscale, re-grid and quantise every Element, and remove the background separately in most cases.

Shortlist to prototype, in order:

1. **Retro Diffusion** (RD Plus at $0.06/image, RD Pro at $0.18): native pixel sizes 12 to 384px, `remove_bg`, `input_palette`, `seed`, reference images on Pro, custom styles trained from one reference image, free palette and downscale tools, prepaid balance that never expires, no subscription. A 15-Element Scene is $0.90 on Plus, $2.70 on Pro (just over £2; mix the two).
2. **PixelLab** (Pixen/Pixflux at about $0.008/image, Pro Flash about $0.03, Pro $0.08): the cheapest by far, with `no_background`, `target_palette` as hex colours, `style_image` for consistency, and an official TypeScript SDK and MCP server. The catch: the public site sells subscriptions ($12/month and up) and the API bills from a separate USD credit balance whose purchase flow and minimum could not be confirmed without an account. The first prototype step is to log in and check whether credits can be bought with no plan.
3. **OpenAI gpt-image** as a fallback for Elements the specialists draw badly: native `background: "transparent"`, strong prompt following, pay-as-you-go. Minimum output is 1024x1024 (655,360 pixels), so every Element needs a downscale-and-requantise step; cost per Element is $0.01 to $0.17 depending on quality.

## Constraints checked

| Constraint (issue #1) | Retro Diffusion | PixelLab | OpenAI | Google Gemini | Stability | fal.ai | Replicate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pay-as-you-go, no monthly minimum | Yes, prepaid balance | API credits exist; purchase without a plan unconfirmed | Yes | Yes | Yes, credits | Yes | Yes |
| 15 Elements at or under $2.60 | $0.45 to $2.70 by tier | $0.13 to $1.20 | $0.17 to $2.50 by quality | $0.50 to $2.01 by model | $0.45 (+$0.75 bg removal) | about $0.53 | $0.05 to $0.38 |
| Native pixel resolution | Yes | Yes | No (1024px min) | No | No | No | No |
| Transparent output | `remove_bg` flag | `no_background` flag | `background: transparent` | Not documented | Separate $0.05 call | Separate model call | Separate model call |
| Palette control | `input_palette` image | `target_palette` hex list (beta), `color_image` | No | No | No | No | No |
| Style lock across calls | reference_images (Pro), custom styles, seed | style_image, reference_images, seed | Reference images in edits; no seed | Multi-image conditioning | Style endpoints | LoRA + seed | LoRA + seed |
| Outputs usable publicly | Yes, owned by generator, no attribution | Yes, user owns copyright | Yes (standard terms, not re-read today) | Yes (SynthID watermark) | Yes | Per model licence | Per model licence |
| TypeScript SDK | No SDK; plain fetch examples in Node, hosted MCP | Official JS/TS SDK, MCP | `openai` npm | `@google/genai` npm | REST only | `@fal-ai/client` | `replicate` npm |

## Retro Diffusion

Source of truth is the API guide at https://www.retrodiffusion.ai/app/guide/api (needs login). The facts below come from the official `api-examples` repo, which the vendor says mirrors it, and from the public site.

**Pricing** ([llms.txt](https://github.com/Retro-Diffusion/api-examples/blob/main/llms.txt), "Costs" section, repo header says "verified 2026-09"; confirmed on https://retrodiffusion.ai/ 2026-10-23):

- Flat per image at any size: RD Fast $0.03, RD Plus $0.06, RD Pro $0.18. Tilesets $0.10. Animations $0.07 to $0.25.
- Prepaid USD balance, charged before generation, refunded automatically on failure. The site: "Pay per generation from a prepaid balance, with images starting at $0.03. The exact price is always shown before you commit."
- `check_cost: true` is a free dry run that returns the price.
- Terms, section 3 (https://retrodiffusion.ai/terms, read 2026-10-23): "Balance doesn't expire. It has no cash value, can't be transferred and isn't refundable." Plans (subscriptions) exist but are separate; the API runs from balance.
- Minimum top-up: not shown on any public page; check at https://www.retrodiffusion.ai/app/devtools after login.
- 15 Elements: Fast $0.45, Plus $0.90, Pro $2.70. A 20-Element Scene on Pro is $3.60, over the ceiling; on Plus $1.20.

**Resolution and pixel control** (llms.txt):

- API accepts 12x12 to 512x512; styles cap it. RD Pro: 12 to 256px. RD Plus: 64 to 384px for most styles, 16 to 128px for `rd_plus__low_res`. RD Fast via `rd_mini__fast_low_res`: 16 to 128px.
- Output is native pixel resolution. `upscale_output_factor` (1 = native) gives an integer upscale on request. The site: "True pixel resolutions from 16×16 icons up to 384×384 scenes, depending on the style, with lossless nearest-neighbor upscaled downloads."
- `input_palette` (base64 PNG) "constrains output colors". Free edit tools: `palette_converter` (remap to a palette, dither options), `color_reducer`, `k_centroid_downscale`, `pixel_correction`.
- `tile_x` / `tile_y` for seamless tiles.

**Transparency**: `remove_bg: true` on the generation request returns a transparent PNG. Vendor craft guide: prompt "on a plain white background" (a flat colour that contrasts the subject) and set `remove_bg`; never write "transparent background" in the prompt. A separate `background_remover` edit tool costs $0.01.

**Style consistency**: `seed` (int, reproducible). `reference_images` (up to 9, RD Pro only) "guides style/content without redrawing". Custom styles: `POST /v2/styles` with exactly one reference image, optional `force_palette` and `force_bg_removal`; the result is a `prompt_style` id usable on every later call. Image variants (day/night, weather): vendor advises generating once and deriving variants with the `image_edit` tool ($0.18), because independent generations "come out as N unrelated compositions".

**Rate limits and latency**: no general request limit is published. Pixel Fixer: 10 requests/minute per token. Assistant: 30 messages/minute. v2 generation is always asynchronous: POST returns a `task_id`, poll `GET /v2/inferences/tasks/{task_id}`. Idempotency-Key header is required practice for paid calls. Outputs are retrievable for 24 hours.

**API shape**: REST, base `https://api.retrodiffusion.ai/v2`, header `X-RD-Token`. No official npm package; the repo ships dependency-free Node examples (`generate_image.mjs`). Hosted MCP server at `https://mcp.retrodiffusion.ai/mcp` with 33 tools, with a Claude Code setup guide in the [retro-diffusion-mcp](https://github.com/Retro-Diffusion/retro-diffusion-mcp) repo.

**Terms** (https://retrodiffusion.ai/terms, read 2026-10-23):

- Section 6: "outputs are owned by the person who generated them, and we assign to you any rights we have in them." Section 5: "Attribution to Retro Diffusion isn't required."
- Site FAQ: "Everything you generate is yours, for personal and commercial projects alike."
- Section 7: no training on outputs. Retro Diffusion may use outputs (not inputs) to train its own models.
- Section 3: "Content created with free usage may be public"; paid accounts can keep content private.

**Surprises**: the free `pixel-fixer` endpoints ("Restore an enlarged or softened image to its native pixel grid") accept any image up to 16 megapixels, so they could clean up output from OpenAI or Gemini at no cost. `rd_advanced_animation__subtle_motion` ($0.25) makes an ambient-motion GIF from a still, relevant to the "looping props" question in issue #1. Low-poly 3D is out of scope but exists.

## PixelLab

**Pricing** (https://www.pixellab.ai/pixellab-api, read 2026-10-23, labelled "estimated price, varies with GPU processing time"):

| Endpoint | Size | Price | With transparent background |
| --- | --- | --- | --- |
| `POST /v2/create-image-pixen` | 32x32 / 64x64 / 128x128 / 256x256 / 512x512 | $0.0070 / $0.0072 / $0.0079 / $0.0089 / $0.0169 | not listed separately |
| `POST /v2/create-image-pixflux` | 64x64 / 128x128 / 320x320 / 400x400 | $0.0079 / $0.0079 / $0.0101 / $0.0132 | $0.0084 / $0.0085 |
| `POST /v2/create-image-bitforge` (style image) | 32 / 64 / 128 / 200 | $0.0071 / $0.0072 / $0.0080 / $0.0112 | $0.0073 / $0.0074 / $0.0082 / $0.0129 |
| `POST /v2/create-image-pro-flash` | 32 / 64 / 128 / 256 (beta) | with transparency: $0.024 / $0.024 / $0.029 / $0.033 | included |
| `POST /v2/generate-image-v2` (Pro, grid of variations) | up to 256 / 341 / 512 | $0.08 / $0.115 / $0.15 | included |
| `POST /v2/generate-with-style-v2` (Pro, style refs) | up to 256 / 341 / 512 | $0.08 / $0.115 / $0.15 | included |
| `POST /v2/remove-background` | 64 / 128 / 256 | $0.0055 / $0.0055 / $0.0059 | n/a |

15 Elements at 128px: Pixen/Pixflux $0.13, Pro Flash $0.44, Pro $1.20.

**Billing model**, the open question: the pricing page (https://www.pixellab.ai/#checkout, read 2026-10-23) sells subscriptions only: Free (40 fast generations, then 5 slower a day, API access and MCP included), Tier 1 $12/month for 2,000 generations, Tier 2 $24/month for 5,000 and 512px, Tier 3 $50/month. The API page prices every call in USD, and `GET /v2/balance` "Returns the current balance for your account, including both USD credits and remaining subscription generations." So API USD credits exist alongside subscription generations, but no public page shows how to buy credits or the minimum amount. Confirm in account settings (https://pixellab.ai/account) before choosing PixelLab. The refund policy (updated 2026-01-14) refunds a purchase if under 50 generations were used, which suggests purchases are one-off.

**Resolution and pixel control** (OpenAPI spec https://api.pixellab.ai/v2/openapi.json, read 2026-10-23):

- Pixen: minimum side 16, maximum area 512x512, sides divisible by 4, square below 32. Pixflux: area 32x32 to 400x400. Bitforge: up to 200x200. Pro Flash native sizes 16 (experimental), 24, 32, 32x48, 48, 64, 96x64, 96, 128; custom 16 to 256 in 4px steps (beta). Pro (`generate-image-v2`) 16 to 512.
- Output is native pixel resolution ("One native pixel art image at the requested size").
- Palette: `color_image` ("Forced color palette, image containing colors used for palette") on Pixflux and Bitforge; `target_palette` (beta) on Pro and Pro Flash takes 2 to 256 hex colours and an optional `max_colors` cap: "every result pixel is put on" the palette.
- `POST /v2/unzoom` restores upscaled pixel art to its native grid; the docs say to run reference images through it first.

**Transparency**: `no_background: true` on Pixen (up to 65,536px of area), Pixflux, Bitforge, Pro Flash and Pro, with `background_removal_task` choosing `remove_simple_background` or `remove_complex_background`. Separate `/v2/remove-background` for existing images.

**Style consistency**: `style_image` on Bitforge (`style_strength` 0 to 100), Pro Flash and Pro ("Optional style image for pixel size and style reference", with `style_options` for what to copy). `generate-with-style-v2` takes 1 to 4 style images and deduces the output size from them. `reference_images` (up to 4) on Pro for subject guidance. `seed` on every endpoint; Pro Flash notes "the image provider does not promise deterministic output". Pixflux and Bitforge have `outline`, `shading` and `detail` enums for a house look.

**Rate limits and latency**: not published. Tier 2 lists "up to 10 concurrent background jobs", Tier 3 "up to 20". Most endpoints return a job id; poll `GET /v2/background-jobs/{job_id}`.

**API shape**: REST, base `https://api.pixellab.ai/v2`, `Authorization: Bearer` token from account settings. Official SDKs listed at https://api.pixellab.ai/v2/llms.txt: Python (`pip install pixellab`), JavaScript/TypeScript ([pixellab-code/pixellab-js](https://github.com/pixellab-code/pixellab-js); npm `@pixellab-code/pixellab` 1.0.2, last published 2025-06-15), and an MCP server ([pixellab-code/pixellab-mcp](https://github.com/pixellab-code/pixellab-mcp)). The GitHub READMEs returned 404 on the `main` branch when fetched raw; the repos may use another default branch.

**Terms** (https://www.pixellab.ai/termsofservice, read 2026-10-23): "You own the copyrights to your creations, permitting usage for both commercial and non-commercial purposes with no need for permission." No training other models on outputs. "Programmatic usage is only allowed through our official API. Our API is designed for vibe coding and in-game live asset creation"; other uses (building a service, reselling) need an email to the vendor. A personal site of composed Scenes fits the stated purpose; worth a one-line email if in doubt. Users agree to the Open RAIL-M licence terms. Not available in Russia, Belarus, Iran, Venezuela.

## OpenAI gpt-image

Sources: https://developers.openai.com/api/docs/pricing and https://developers.openai.com/api/docs/guides/image-generation, read 2026-10-23.

- Models today: `gpt-image-1`, `gpt-image-1-mini`, `gpt-image-1.5`, `gpt-image-2`, `gpt-image-2.5-sunburst` (editing precision) and `gpt-image-2.5-flare` (fast everyday generation).
- Pricing is per image-output token: gpt-image-1 $40/1M, gpt-image-1-mini $8/1M, gpt-image-1.5 $32/1M, gpt-image-2 and 2.5 $30/1M. The pricing page points to a calculator in the guide for per-image figures; from OpenAI's published token counts for gpt-image-1 at 1024x1024 (272 tokens low, 1,056 medium, 4,160 high; figures from the guide's earlier version, not re-read today) that is about $0.011, $0.042 and $0.167 per image. 15 Elements: $0.17 low, $0.63 medium, $2.50 high. gpt-image-1-mini is a fifth of that.
- Pay-as-you-go with prepaid credits; no monthly minimum. "You may need to complete API Organization Verification in the developer console before using GPT Image models."
- Sizes: recommended 1024x1024, 1536x1024, 1024x1536; custom sizes in multiples of 16, total pixels between 655,360 and 8,294,400. There is no small output, so a 64px Element means generating at 1024px and downscaling 16x. Whether the model draws on a clean 16px grid is the main thing to test.
- Transparency: `background: "transparent"` with `output_format` png or webp.
- Style consistency: edits accept multiple reference images (the guide's example uses four); no seed parameter; the guide's Limitations say the model "may occasionally struggle to keep recurring characters or brand elements visually consistent across generations".
- Rate limits: not in the portion of the guide read; tier-based.
- SDK: `openai` npm. Terms not re-read today; OpenAI's standard terms assign output ownership to the user and permit commercial use. Outputs carry C2PA metadata (not re-verified today).

## Google Gemini image models

Source: https://ai.google.dev/gemini-api/docs/pricing and https://ai.google.dev/gemini-api/docs/imagen, read 2026-10-23.

- Imagen is gone: "Imagen models are shut down and no longer available in the Gemini API." Google points to the Nano Banana models.
- Current per-image prices (standard tier): `gemini-2.5-flash-image` $0.039 (deprecated, shutting down 2026-10-02 per the page, so effectively unavailable); `gemini-3.1-flash-image` $0.045 at 0.5K, $0.067 at 1K; `gemini-3.1-flash-lite-image` $0.0336 at 1K; `gemini-nano-banana-2.1` $0.0336 at 1K; `gemini-3-pro-image` $0.134 at 1K/2K. Batch is about half. No free tier for these models in the API.
- 15 Elements: $0.50 on nano-banana-2.1 or flash-lite, $1.00 on 3.1 flash, $2.01 on 3 pro.
- Smallest output 0.5K (about 512px); no transparent-background parameter documented; SynthID watermark on outputs. Not pixel-native. Conversational multi-image editing is the consistency mechanism. SDK `@google/genai`.
- Not shortlisted: no transparency, no small sizes, no palette control, and no price advantage over OpenAI.

## Stability AI

Source: https://docs.stability.ai/pricing, read 2026-10-23.

- 1 credit = $0.01; 25 free credits on signup; no minimum purchase stated. Stable Image Core 3 credits ($0.03), Ultra 8 ($0.08), SD3.5 Large 6.5, Large Turbo 4, Medium 3.5, Flash 2.5. Remove Background 5 credits ($0.05).
- 15 Elements on Core with background removal: $1.20. Outputs are 1MP-class, not pixel-native; no palette control; REST only, no official TypeScript SDK. Not shortlisted.

## fal.ai and Replicate (pixel-art LoRAs on FLUX / SDXL)

Sources: https://fal.ai/pricing, https://fal.ai/models/fal-ai/flux-lora, https://replicate.com/pricing, https://replicate.com/docs/topics/billing, read 2026-10-23.

- Both are pay-as-you-go with no stated minimum. fal bills per image or per megapixel (FLUX.1 schnell $0.003/MP; `fal-ai/flux-lora` $0.035/MP, rounded up to the nearest megapixel, so a small image still costs $0.035). Replicate bills per output image for official models (flux-schnell $0.003, flux-dev $0.025, flux-1.1-pro $0.04) or per GPU second for community models (T4 $0.000225/s to H100 $0.001525/s); public-model cold boots are not charged; prepaid credit or monthly arrears.
- `fal-ai/flux-lora` accepts a LoRA URL and a seed and is tagged "commercial use" by fal. Individual pixel-art LoRA licences (and the FLUX.1 dev non-commercial base licence) were **not verified** today; any LoRA route needs a licence check per weight file before outputs go on a public site.
- Neither marketplace was checked for a hosted Retro Diffusion or other pixel-native model today (see Coverage note). FLUX/SDXL LoRAs render a pixel look at 1024px; the pipeline would need downscale, re-grid (Retro Diffusion's free Pixel Fixer or PixelLab's `unzoom` could do this) and a separate background-removal call.
- 15 Elements on `flux-lora`: about $0.53 before background removal. Cheap, but three extra steps per Element and a licence question. Not shortlisted for the first prototype; keep as the cost fallback.

## What a prototype should test

1. **PixelLab credit purchase**: log in, check whether USD credits can be bought without a subscription and the minimum. If not, PixelLab fails the no-monthly-minimum constraint and Retro Diffusion is the only pixel-native option.
2. **Palette fidelity**: generate the same Element on Retro Diffusion (`input_palette`) and PixelLab (`target_palette` hex) with a 16-colour Scene palette; count colours in the PNG. Also test the free `palette_converter` for re-palettising library Elements.
3. **Style lock**: one Retro Diffusion custom style and one PixelLab `style_image`, then 10 Elements each; judge whether a lamp, a cat and a skyline read as one hand.
4. **Transparency edges**: inspect the alpha channel (not a composite) for halo pixels after `remove_bg` / `no_background`, as the Retro Diffusion craft guide warns vision models cannot see alpha.
5. **Size sweet spot**: Elements at 32, 64, 128px on each service; pick the house density from what looks hand-made.
6. **OpenAI as fallback**: one hard Element (rain-streaked window) at 1024px low quality with `background: transparent`, downscaled 16x with nearest-neighbour and passed through Retro Diffusion's free Pixel Fixer, to see if the grid holds.
7. **Determinism**: repeat a call with the same seed on both specialists; PixelLab's Pro Flash says seeds are recorded but not guaranteed.

## Coverage note

Verified today from primary sources: Retro Diffusion (API contract, prices, terms), PixelLab (API spec, per-call prices, subscription tiers, terms, refund policy), OpenAI (pricing table, size and background parameters, verification note), Google (pricing table, Imagen shutdown), Stability (credit prices), fal.ai and Replicate (billing model, FLUX prices, `flux-lora` price and LoRA input).

Not verified, and worth a follow-up ticket if any shortlisted choice depends on it:

- PixelLab API credit purchase flow and minimum top-up (needs a login).
- Retro Diffusion minimum top-up and general API rate limit (not on any public page; the guide needs a login).
- OpenAI per-image prices were derived from token counts remembered from an earlier version of the guide, not read today; OpenAI's current terms and rate limits were not re-read.
- Which pixel-art LoRAs and pixel-native models are hosted on fal.ai and Replicate in October 2026, their per-model licences, and the price of background-removal endpoints there.
- Gemini transparency support (no parameter found; absence not proven).
- Three background research agents covering these gaps were started but did not report before this ticket was closed.
