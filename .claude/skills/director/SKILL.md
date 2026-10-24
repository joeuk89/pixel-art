---
name: director
description: Turn a Prompt into a Scene: plan it, stop once at the Plan gate for the owner's yes, then generate, check and stage it for the owner to preview and commit.
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

Run `node pipeline/scene-id.ts <three to five words from the Prompt>` and use its `id`, `seed` and `createdAt`. Write `scenes/<id>/scene.json` with `status: "draft"`, a first-draft `description` written from the Concept, `styleAnchor: null`, a zeroed `cost` block (`approvedOverage: null`) and every Element as a Placement with a `generate` block and a proposed Element id (`<subject>-<two-or-three-descriptors>-01`). Use house Palette indices for every colour; while a new Palette is only proposed, set `palette` to the nearest house Palette and say so at the Plan gate.

**Done when** `node pipeline/validate.ts scenes/<id>` exits 0.

## 4. Derive canvases

Run `node pipeline/derive-canvas.ts scenes/<id>/scene.json`.

**Done when** every prop's canvas is known and the hero prop's canvas is within a step or two of 48 px; if it is not, change `scale` or the `realSize` values and run it again.

## 5. Shop

For each Element run `node pipeline/library-search.ts <subject words> --palette <palette>`. A candidate qualifies only when its subject is what the Placement needs and its `size` equals the derived canvas (backdrops are always 128x64). Before reusing a qualifying candidate, view it: write an 8x nearest-neighbour copy into `scratch/` with sharp and open it with Read, and open its `.strip.png` too when `hasStrip` is true. Reuse it only if what you see matches the Placement's brief and passes points 1 to 4 of [rubric.md](rubric.md).

For each sound run `node pipeline/library-search.ts <words> --sounds` and read the record of any candidate before choosing it.

While a new Palette is proposed, no library Element qualifies for reuse: the stand-in house Palette is not the Scene's Palette. Every Element stays generated, and the Plan gate says so.

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

Wait for the owner. Apply any edits to the plan. If an edit changes `scale`, any `realSize` or any Element, put a `generate` block back on every reused Placement it affects, because `derive-canvas` skips Placements without one. Then rerun step 4 and step 5 for the affected Placements, so every reused Element's size is checked against its new canvas. Run `node pipeline/validate.ts scenes/<id>` until it exits 0, and show the brief again.

**Done when** the owner has said yes to the brief as shown. Record an approved overage in `cost.approvedOverage` with its reason. If the owner approves the new Palette, write it to `library/palettes/`, point the plan at it, re-pick every `fill` and Primitive colour index against the new Palette, and run `node pipeline/validate.ts scenes/<id>` again until it exits 0. If the owner rejects the new Palette, set the plan to a house Palette, rerun step 5 against that house Palette, and show the brief again. Then go straight on to step 7.

## 7. Generate

From the owner's yes until the preview, never ask the owner anything. Every decision here is yours, and anything that goes wrong ends in the report at step 9, not in a question. Run each script that calls a service as `node --env-file=.env pipeline/<script>.ts`; the plan path below is `scenes/<id>/scene.json`.

1. In parallel: `pipeline/music.ts <plan>`, `pipeline/ambient.ts <plan>`, and the Style anchor. Generate the anchor with `pipeline/generate-element.ts <plan> <placementId>`, judge it as in point 3 and accept it with `--accept <png> --style-anchor`. If the plan has no generated prop of 48 px or more on its longer side, there is no anchor; go on.
2. Then every other generated Element, backdrops and props, in batches of up to 8 parallel `generate-element` runs. The script sends the anchor as the style image wherever it fits the canvas.
3. Judge every Attempt by the Quality gate. Its `gate.ok` must be true; then open its 8x upscale (`scratch.upscale`) with Read and check the five points of [rubric.md](rubric.md) against the anchor and the Elements already accepted for this Scene. Accept with `--accept <png>` only when both pass. Otherwise climb the still retry ladder in rubric.md, one rung per Attempt: run again unchanged; then pass `--brief` with the brief reworded to name the defect; then change the decomposition in the plan (split, merge or resize the Element), rerun `derive-canvas` and `validate`, and run again.
4. After the fourth failed Attempt, or when the script refuses one, abandon the Element. Search for a substitute with `pipeline/library-search.ts <subject> --palette <palette> --size <WxH>` and view each candidate at 8x. If one passes points 1 to 4 of the rubric, run `generate-element <plan> <placementId> --abandon --substitute <elementId>`; otherwise `--abandon` alone drops the Placement and the Primitives anchored to it.
5. Frame strips last, only for Elements whose still was accepted with `stripRequested` in the accept output: `pipeline/generate-strip.ts <elementId> --scene <plan>`, with `--service`, `--frames` and `--motion` as planned. Judge its strip gate and its 8x upscale the same way and accept with `--accept <strip.png> --scene <plan>`. Follow the strip retry ladder in rubric.md; when the ladder ends, `--abandon --scene <plan>` keeps the still.
6. After each batch run `pipeline/budget.ts <plan>`. When `capsHit` names a cap, start no new Attempt it covers: let the Attempts in flight finish, abandon each still Element left as in point 4, fall each strip left back to its still, and keep the caps hit for the report.

Elements that passed the gate stay in the library even when a later step drops their Placement. If a script fails mid-run, the plan stays `draft` with everything accepted kept; rerun this step and it carries on from the Placements that still have a `generate` block.

**Done when** no Placement has a `generate` block, every planned strip is accepted or fallen back to its still, the music has a measured seam, every Ambient loop and One-shot file sits beside the plan, and `node pipeline/validate.ts scenes/<id>` exits 0.

## 8. Hard checks

Rewrite the plan's `description` to fit the Scene as generated: two or three sentences in plain present tense that a visitor reads in the Viewer's info panel and in link previews. Describe what the Scene shows and how it feels, from the Prompt's intent and the Elements, Primitives and sounds that made it in. Leave out anything abandoned, any address to the Director, and the Prompt's working notes. Then run `node pipeline/poster.ts scenes/<id>/scene.json`, then `node pipeline/stage.ts scenes/<id>/scene.json`, then `node pipeline/check-scene.ts scenes/<id>/scene.json`. check-scene reports each hard check: every `generate` block resolved, `validate` green, the loop seam measured, the Poster equal to frame 0 of the plan, the stub and `gallery.json` current, and `npm test` passing.

When a check names a mechanical fix (run poster, run stage, or `music.ts --force` for an unmeasured seam), make it and run check-scene again. On any other failure, stop and report the failing checks: the Scene stays `draft` with its completed work kept, so a later run resumes at step 7.

**Done when** the `description` matches the generated Scene and `node pipeline/check-scene.ts scenes/<id>/scene.json` exits 0.

## 9. Preview

Start the dev server with `npm run dev` in the background unless something already listens on port 8000. Then run `node pipeline/preview.ts scenes/<id>/scene.json`: it runs the hard checks again, marks the Scene `resolved`, stages the Scene folder, new library files, any new Palette and `gallery.json`, and prints the report. Show the owner:

- the preview URL
- the staged files
- the cost block, beside the estimate from the Plan gate
- the ledger: the month's PixelLab generations and metered spend after this commit, against the 2,000-generation and £50 ceilings
- every abandoned Element and what happened to it (substituted, dropped or still only), offering a paid retry for each dropped one, and any cap that stopped generation
- the proposed commit message

Then stop. Never commit or push: the owner does both.

**Done when** preview exited 0, its report is shown to the owner, and `git log` shows no commit made by this run.

## 10. Rejection

If the owner rejects the preview, change only what the owner named, under the same Scene id. For Placements whose Element should change, run `node pipeline/reopen.ts scenes/<id>/scene.json <placementId...>`: it puts a `generate` block back on each with a fresh proposed id and marks the Scene `draft`. Apply the owner's edits to those blocks, rerun `derive-canvas` when a size changed, and run `validate`. For any other change, set `status: "draft"` first, then edit positions, Layers, Primitives or the Soundtrack in the plan directly, and rerun `music.ts --force` only when the owner rejects the music. Then run step 7 for the reopened Placements only, step 8 and step 9.

**Done when** the owner accepts a preview or ends the session; every Placement the owner did not name keeps its Element.
