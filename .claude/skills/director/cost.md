# Cost estimate

The Plan gate shows two numbers for the Scene, each against the per-Scene budget and the month's ceiling.

## PixelLab generations

From the PixelLab prototypes:

| Call | Generations |
| --- | --- |
| Pro Flash prop, any canvas | 5 |
| Pro Flash backdrop, 128x64 | 6 |
| animate v3 Frame strip | 1 |

The estimate is one first Attempt for every generated Element plus one call per planned PixelLab strip. Reused Elements cost nothing.

Per-Scene budget: 3x that first-Attempt estimate, which leaves room for retries. This reads the spec's "3x planned Elements" in generations, because a single Pro Flash prop already costs 5.

## Metered USD

| Item | Price |
| --- | --- |
| Music, Stable Audio 3.0 | $0.08 per generation |
| Generated ambient, ElevenLabs via fal.ai | $0.002 per second (a 22 s loop is $0.044) |
| Retro Diffusion Frame strip, 8 frames | $0.25 per Attempt |

Curated Ambient loops cost nothing. Per-Scene budget: $1.00 metered.

## Against the month

Run `node pipeline/ledger.ts` and add this Scene's estimate to its `pixellabGenerations.used` and `metered.usd`. Show both totals against the 2,000-generation and £50 ceilings, using the exchange rate the ledger prints.

## Overage

If either estimate exceeds its per-Scene budget, or the month's total would pass a ceiling, say by how much and why ("music plus four Retro Diffusion strips: $1.08 against $1.00"), and ask. A yes goes in the plan's `cost.approvedOverage` with the reason and the approved amounts.
