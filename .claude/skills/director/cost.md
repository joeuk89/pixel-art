# Cost estimate

The Plan gate shows two numbers for the Scene, each against the per-Scene budget and the month's ceiling.

## PixelLab generations

Pro Flash charges by the longer side of the canvas. `derive-canvas` prints each Element's tier and the total:

| Pro Flash canvas, longer side | Generations |
| --- | --- |
| up to 64 px | 5 |
| 65 to 196 px | 6 |
| 197 to 256 px | 9 |

A Backdrop goes to Pro Flash at its own size whenever both sides are 256 px or under. A larger Backdrop needs another service, chosen with `generate-element --service`:

| Backdrop service | Cost per Attempt | Style anchor |
| --- | --- | --- |
| `pro-flash`, up to 256 px a side | 5, 6 or 9 generations, as above | yes |
| `pro`, PixelLab Pro | about 25 generations at 384x240 | yes |
| `pixflux`, PixelLab Pixflux | 1 generation | no |
| `rd-plus`, Retro Diffusion RD Plus | $0.06 metered | no |

A PixelLab animate v3 Frame strip is 1 generation. Local Finish costs nothing.

The estimate is one first Attempt for every generated Element at its tier, a Backdrop over 256 px at Pro's 25, plus one call per planned PixelLab strip. Reused Elements cost nothing.

Per-Scene budget: 3x that first-Attempt estimate, which leaves room for retries. This reads the spec's "3x planned Elements" in generations, because a single Pro Flash prop already costs 5 to 9.

## Metered USD

| Item | Price |
| --- | --- |
| Music, Stable Audio 3.0 | $0.08 per generation |
| Generated ambient, ElevenLabs via fal.ai | $0.002 per second (a 22 s loop is $0.044) |
| Retro Diffusion Frame strip, 8 frames | $0.25 per Attempt |
| Retro Diffusion RD Plus Backdrop | $0.06 per Attempt |

Curated Ambient loops cost nothing. Per-Scene budget: $1.00 metered.

## Against the month

Run `node pipeline/ledger.ts` and add this Scene's estimate to its `pixellabGenerations.used` and `metered.usd`. Show both totals against the 2,000-generation and £50 ceilings, using the exchange rate the ledger prints.

## Overage

If either estimate exceeds its per-Scene budget, or the month's total would pass a ceiling, say by how much and why ("music plus four Retro Diffusion strips: $1.08 against $1.00"), and ask. A yes goes in the plan's `cost.approvedOverage` with the reason and the approved amounts above the budget (`pixellabGenerations`, `meteredUsd`). `pipeline/budget.ts` adds them to the caps during generation.
