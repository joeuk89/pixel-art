---
name: director
description: Turn a Prompt into a draft Scene plan and stop at the Plan gate for the owner's yes.
argument-hint: <Prompt>
disable-model-invocation: true
---

# Director

## 1. Concept

The Prompt is `$ARGUMENTS`, the only input. Write the Concept in your reply as your first output, before any tool call that reads `library/` or runs a pipeline script:

- setting
- time
- weather
- the one light source
- the focal point
- two details, quoted in the Prompt's own words

The Concept decides what the Scene is about. The Element library is shopped later and never changes the Concept.

**Done when** all six lines are in your reply and no library search, library file or pipeline output appears before them in the transcript.

## 2. Decompose

Read [composition.md](composition.md), [briefs.md](briefs.md) and [soundtrack.md](soundtrack.md). Read the Scene plan shape and the Primitive catalogue from `scenePlanSchema` and `primitiveSchema` in `schema/index.ts`: that schema is what the Viewer draws and `validate` enforces. Read `name`, `mood` and `colours` from every file in `library/palettes/`.

Compose this Scene from its Concept. The patterns in composition.md are worked examples; depart from them whenever the Concept asks.

- Palette: the house Palette whose `mood` fits the Concept, or a proposed new one (name, up to 32 colours with 16 the default, index 0 the background, one line on why no house Palette fits).
- Scale: from the defaults in composition.md, tuned so the hero prop lands near 48 px. State why when you depart from a default.
- Layers in draw order, each with `fill` or Placements. Every Element is a 128x64 backdrop or a prop up to 128x128 with a `realSize` in metres taken from the reference heights.
- Motion: an engine Primitive where the catalogue supplies it; a Frame strip for living things and soft matter that should move subtly; otherwise static. Motion the catalogue lacks goes on the missing-Primitive list with the nearest existing Primitive, never into an Element's brief.
- Soundtrack: a music brief, Ambient loops with Distances and any One-shots, by soundtrack.md.

**Done when** every Concept line is carried by at least one Layer, Placement, Primitive or sound; every prop has a `realSize`; every brief passes the ban list in briefs.md; and the Palette is a house Palette or a full proposal.

## 3. Working draft

Run `node pipeline/scene-id.ts <three to five words from the Prompt>` and use its `id`, `seed` and `createdAt`. Write `scenes/<id>/scene.json` with `status: "draft"`, `styleAnchor: null`, a zeroed `cost` block (`approvedOverage: null`) and every Element as a Placement with a `generate` block and a proposed Element id (`<subject>-<two-or-three-descriptors>-01`). Use house Palette indices for every colour; while a new Palette is only proposed, set `palette` to the nearest house Palette and say so at the Plan gate.

**Done when** `node pipeline/validate.ts scenes/<id>` exits 0.

## 4. Derive canvases

Run `node pipeline/derive-canvas.ts scenes/<id>/scene.json`.

**Done when** every prop's canvas is known and the hero prop's canvas is within a step or two of 48 px; if it is not, change `scale` or the `realSize` values and run it again.

## 5. Shop

For each Element run `node pipeline/library-search.ts <subject words> --palette <palette>`. A candidate qualifies only when its subject is what the Placement needs and its `size` equals the derived canvas (backdrops are always 128x64). Before reusing a qualifying candidate, view it: write an 8x nearest-neighbour copy into `scratch/` with sharp and open it with Read, and open its `.strip.png` too when `hasStrip` is true. Reuse it only if what you see matches the Placement's brief and passes points 1 to 4 of [rubric.md](rubric.md).

For each sound run `node pipeline/library-search.ts <words> --sounds` and read the record of any candidate before choosing it.

To reuse, set the Placement's `element` to the library id and delete its `generate` block. Every other Element stays generated.

**Done when** every Element is marked reused (with the PNG viewed and subject, Palette and canvas size matching) or generated, every sound is curated (by record id) or generated (with a brief), and `node pipeline/validate.ts scenes/<id>` exits 0.

## 6. Plan gate

Estimate the cost by [cost.md](cost.md), with month-to-date spend from `node pipeline/ledger.ts`. Show the owner the set-design brief:

- the Concept
- the Palette, house or proposed new
- the Scale and why
- the Style anchor: which generated prop it will be, or why there is none
- every Element: Placement id, real size, canvas size, reused (library id) or generated (brief)
- the Primitives, plus each missing Primitive with the nearest existing one
- the Soundtrack sources: music brief, each Ambient loop and One-shot with its Distance, curated or generated
- the estimated cost: PixelLab generations and metered USD for this Scene, against the per-Scene budget and against the month's 2,000-generation and £50 ceilings

Call out, each on its own line: budget overage with the amount and the reason; every missing Primitive with the nearest existing one; the proposed new Palette with why no house Palette fits.

Wait for the owner. Apply any edits to the plan, run validate, and show the brief again.

**Done when** the owner has said yes to the brief as shown. Record an approved overage in `cost.approvedOverage` with its reason, and write an approved new Palette to `library/palettes/` and point the plan at it. Then stop: generation is not part of this skill yet.
