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
- the space: indoors, the room width, height and depth in metres; outdoors, the ground width and depth and the horizon height
- the eye height in metres
- the one light source
- the focal point
- two details, quoted in the Prompt's own words

The Concept decides what the Scene is about. The Element library is shopped later and never changes the Concept.

**Done when** all eight lines are in your reply and no library search, library file or pipeline output appears before them in the transcript.

## 2. Decompose

Read [staging.md](staging.md), [composition.md](composition.md), [briefs.md](briefs.md), [cost.md](cost.md) and [soundtrack.md](soundtrack.md). Read the Scene plan shape and the Primitive catalogue from `scenePlanSchema` and `primitiveSchema` in `schema/index.ts`: that schema is what the Viewer draws and `validate` enforces.

Compose this Scene from its Concept. The patterns in composition.md are worked examples; depart from them whenever the Concept asks.

- Stage and Scale: run `derive-stage` from the Concept's space and eye height by staging.md, and take its `stage` and `scale`.
- Layers on their Planes, the Room shell, its Openings and every Placement, by staging.md and composition.md. Every prop has a `realSize` in metres from the reference heights; every Backdrop has a `size`.
- A brief for every Element by briefs.md, and the Style anchor it names.
- A Finish for every eligible Element by cost.md.
- Motion: an engine Primitive where the catalogue supplies it; a Frame strip for living things and soft matter that should move subtly; otherwise static. Motion the catalogue lacks goes on the missing-Primitive list with the nearest existing Primitive, or none, never into an Element's brief. Put the nearest in the plan as a stand-in.
- Soundtrack: a music brief, Ambient loops with Distances and any One-shots, by soundtrack.md.

**Done when** every Concept line is carried by the Stage, a Layer, Surface, Opening, Placement, Primitive or sound; the Stage came from `derive-stage`; every prop has a `realSize`; every brief passes the ban list in briefs.md; and every drawn Surface carries a Feature or an Opening, or its gap is written down for the Plan gate.

## 3. Lighting

Read [lighting.md](lighting.md). Write the Scene's Variants: the ambient level, the Concept's light source as a point Light on its Placement, window spill and any beam, each by the defaults there. Halo and Primitive colours are picked in step 5, once the Palette is known.

**Done when** the first Variant is the Concept's time and weather, its light source is a point Light anchored to the Placement that emits it with every default from lighting.md or a stated reason to depart, and any second Variant answers something the Prompt asked for.

## 4. Palette

Read `name`, `mood`, `colours` and `ramps` from every file in `library/palettes/`. Only a Palette with `ramps` can light a Scene.

- A house Palette with `ramps` whose `mood` fits the Concept.
- A house Palette that fits but has no `ramps`: propose its `-v2` copy, the same `colours` plus a Ramp table, as a new file (ADR 0001 keeps Palettes immutable).
- Otherwise a proposed new Palette: write it as hue-shifted ramps, then flattened to 16 colours (light steps toward yellow, dark steps toward blue or purple, sharing the darkest, lightest and neutral steps), index 0 the background, with its Ramp table and one line on why no house Palette fits.

**Done when** the Scene names a house Palette with `ramps`, or a full proposal with its `colours` and Ramp table.

## 5. Working draft

Run `node pipeline/scene-id.ts <three to five words from the Prompt>` and use its `id`, `seed` and `createdAt`. Write `scenes/<id>/scene.json` with `status: "draft"`, a first-draft `description` written from the Concept, `styleAnchor: null`, a zeroed `cost` block (`approvedOverage: null`), the Stage, the Variants, and every Element as a Placement with a `generate` block and a proposed Element id (`<subject>-<two-or-three-descriptors>-01`). A local Finish names a generator from `generators` in `pipeline/lib/kits/index.ts` and the params its schema in `pipeline/lib/kits/` takes. Pick every colour index (fills, Surfaces, skirting, frames, Halos, Primitives) from the chosen Palette; while a new Palette is only proposed, set `palette` to the nearest house Palette with `ramps` and say so at the Plan gate.

**Done when** `node pipeline/validate.ts scenes/<id>` exits 0.

## 6. Derive canvases

Run `node pipeline/derive-canvas.ts scenes/<id>/scene.json`, adding `--eligible <placementId>` for every eligible Element whose Finish is service. Local-Finish Elements are listed without the flag.

**Done when** every Element's canvas and tier is known and the Style anchor's canvas fits the rule in briefs.md; if it does not, change its `realSize`, its `foot` or the zoom (rerun `derive-stage` and step 5's Stage) and run it again.

## 7. Shop

For each Element run `node pipeline/library-search.ts <subject words> --palette <palette>`. A candidate qualifies only when its subject is what the Placement needs and its `size` equals the derived canvas. Where a local and a service candidate both qualify, prefer the one whose Finish the Placement asked for. Before reusing a qualifying candidate, view it: write an 8x nearest-neighbour copy into `scratch/` with sharp and open it with Read, and open its `.strip.png` too when `hasStrip` is true. Reuse it only if what you see matches the Placement's brief and passes points 1 to 4 of [rubric.md](rubric.md).

For each sound run `node pipeline/library-search.ts <words> --sounds` and read the record of any candidate before choosing it.

While a new Palette is proposed, no library Element qualifies for reuse: the stand-in house Palette is not the Scene's Palette. Every Element stays generated, and the Plan gate says so.

To reuse, set the Placement's `element` to the library id and delete its `generate` block. Every other Element stays generated.

**Done when** every Element is marked reused (with the PNG viewed and subject, Palette and canvas size matching) or generated, every sound is curated (by record id) or generated (with a brief), and `node pipeline/validate.ts scenes/<id>` exits 0.

## 8. Plan gate

Estimate the cost by [cost.md](cost.md), with month-to-date spend from `node pipeline/ledger.ts`, and rerun step 6 for the canvases, tiers and `finishOffer`. Show the owner the set-design brief:

- the Concept
- the Palette, house or proposed new, with the Ramp table of a proposed one
- the Stage and zoom, with why: the space and eye height given to `derive-stage`, the zoom and the focal point that chose it; and the Scale it gives
- the Room shell: the Surfaces it draws, each with its colour, `lines` and skirting; its Openings, each with its real size in metres and its frame, and the bare-Surface check by staging.md
- the Style anchor: which generated prop it will be, or why there is none
- every Element: Placement id, real size, depth-derived canvas and tier, reused (library id and each reused Element's Finish) or generated (brief and Finish)
- the Variants and their Lights: each Variant's ambient level and Layer offsets, and each Light's type, anchor or point, radius, strength, tint, flicker and Halo
- the Finish offer from `finishOffer`: each eligible Element's service generations and USD against £0 local, the total saving, the shortcuts "all eligible local" and "all service", and the trade-off line from cost.md. No local previews.
- the Primitives, plus each missing Primitive with the nearest existing one, offered as "build it" or "use the nearest"
- the Soundtrack sources: music brief, each Ambient loop and One-shot with its Distance, curated or generated
- the estimated cost: PixelLab generations and metered USD for this Scene, against the per-Scene budget and against the month's 2,000-generation and £50 ceilings

Call out, each on its own line: budget overage with the amount and the reason; every missing Primitive with the nearest existing one and the question "build it or use the nearest?"; the proposed new Palette with why no house Palette fits.

Wait for the owner. Apply any edits to the plan; "all eligible local" sets every eligible Element to a local Finish and "all service" sets every one to service. If an edit changes the Stage, `scale`, any `realSize`, any `foot`, any Finish or any Element, put a `generate` block back on every reused Placement it affects, because `derive-canvas` skips Placements without one. Then rerun step 6 and step 7 for the affected Placements, so every reused Element's size is checked against its new canvas. Run `node pipeline/validate.ts scenes/<id>` until it exits 0, and show the brief again.

**Done when** the owner has said yes to the brief as shown and has answered "build it" or "use the nearest" for every missing Primitive. Record an approved overage in `cost.approvedOverage` with its reason. If the owner approves the new Palette, write it to `library/palettes/`, point the plan at it, re-pick every `fill` and Primitive colour index against the new Palette, along with every Surface, frame and Halo colour, and run `node pipeline/validate.ts scenes/<id>` again until it exits 0. If the owner rejects the new Palette, set the plan to a house Palette, rerun step 7 against that house Palette, and show the brief again. Then go straight on to step 9.

## 9. Build Primitives

Build each missing Primitive the owner answered "build it" for in its own subagent, one after another: every build edits the same schema, Viewer and test files, so two at once collide. Brief each subagent with [primitives.md](primitives.md), the motion the Scene needs, the Palette, and the Placement it will anchor to. Tell it to stage its files, never commit, and reply with the new type's fields, the staged files and the `npm test` result. Building costs no money. Never ask the owner anything here: you and the subagents decide every design question.

When a subagent replies, run `npm test` yourself and open its 8x frames from `scratch/` with Read; send it back to fix whatever fails or reads wrong.

When a Primitive is built, replace its stand-in in the plan with the new type and run `node pipeline/validate.ts scenes/<id>` until it exits 0. Set a region that depends on a generated Element after step 10 accepts that Element.

If a build cannot reach a passing `npm test`, restore the files it changed, keep the stand-in, and note the failure for the report at step 12.

**Done when** every "build it" Primitive is either built (in `primitiveSchema`, drawn by the Viewer, used in the plan, its files staged, `npm test` passing) or abandoned with its files restored, its stand-in kept and the failure noted; and `node pipeline/validate.ts scenes/<id>` exits 0.

## 10. Generate

From the owner's yes until the preview, never ask the owner anything. Every decision here is yours, and anything that goes wrong ends in the report at step 12, not in a question. Run each script that calls a service as `node --env-file=.env pipeline/<script>.ts`; the plan path below is `scenes/<id>/scene.json`.

1. When the plan has a `room` Layer, run `pipeline/room-shell.ts <plan>` first: it writes `room.png` beside the plan, costs nothing and needs only a plan that validates. Then in parallel: `pipeline/music.ts <plan>`, `pipeline/ambient.ts <plan>`, and the Style anchor. Generate the anchor with `pipeline/generate-element.ts <plan> <placementId>`, judge it as in point 3 and accept it with `--accept <png> --style-anchor`. If the plan has no generated prop that fits the Style anchor rule in briefs.md, there is no anchor; go on.
2. Then every other generated Element, backdrops and props, in batches of up to 8 parallel runs: `generate-element` for a service Finish and `pipeline/draw-element.ts <plan> <placementId>` for a local Finish or a Seamless texture, in the same batches. A local run is free and counts against no budget. `generate-element` sends the anchor as the style image wherever it fits the canvas and the Placement's subject is not the anchor's. Backdrops go to Pro Flash at their `size`; only a Backdrop over 256 px on an axis takes `--service pro`, `pixflux` or `rd-plus`, chosen by cost.md.
3. Judge every Attempt by the Quality gate. Its `gate.ok` must be true; then open its upscale (`scratch.upscale`, 8x for small Elements, 4x at 256 px) with Read and check the six points of [rubric.md](rubric.md), or its Backdrop list, against the anchor and the Elements already accepted for this Scene. Accept with `--accept <png>` (on the script that made the Attempt) only when both pass. Accepting a side-wall or floor Feature also writes its projected `features/<placementId>.png`; read the `projected` block it prints. When the upscale shows colours that light themselves (lit windows, bulbs, screens), add `--emissive <i,j>` with their Palette indices, and `--emissive-region x,y,w,h` for each lit area when the same colour also appears unlit in that Element, by lighting.md. Otherwise climb the still retry ladder in rubric.md, one rung per Attempt: run again unchanged; then pass `--brief` with the brief reworded to name the defect; then change the decomposition in the plan (split, merge or resize the Element), rerun `derive-canvas` and `validate`, and run again.
4. After the fourth failed Attempt, or when the script refuses one, abandon the Element. Search for a substitute with `pipeline/library-search.ts <subject> --palette <palette> --size <WxH>` and view each candidate at 8x. If one passes points 1 to 4 of the rubric, run `generate-element <plan> <placementId> --abandon --substitute <elementId>`; otherwise `--abandon` alone drops the Placement and the Primitives anchored to it.
5. Frame strips last, only for Elements whose still was accepted with `stripRequested` in the accept output: `pipeline/generate-strip.ts <elementId> --scene <plan>`, with `--service`, `--frames` and `--motion` as planned. Judge its strip gate and its 8x upscale the same way and accept with `--accept <strip.png> --scene <plan>`. Follow the strip retry ladder in rubric.md; when the ladder ends, `--abandon --scene <plan>` keeps the still.
6. After each batch run `pipeline/budget.ts <plan>`. When `capsHit` names a cap, start no new Attempt it covers: let the Attempts in flight finish, abandon each still Element left as in point 4, fall each strip left back to its still, and keep the caps hit for the report.

Elements that passed the gate stay in the library even when a later step drops their Placement. If a script fails mid-run, the plan stays `draft` with everything accepted kept; rerun this step and it carries on from the Placements that still have a `generate` block.

**Done when** no Placement has a `generate` block, every planned strip is accepted or fallen back to its still, the music has a measured seam, every Ambient loop and One-shot file sits beside the plan, and `node pipeline/validate.ts scenes/<id>` exits 0.

## 11. Hard checks

Rewrite the plan's `description` to fit the Scene as generated: two or three sentences in plain present tense that a visitor reads in the Viewer's info panel and in link previews. Describe what the Scene shows and how it feels, from the Prompt's intent and the Elements, Primitives and sounds that made it in. Leave out anything abandoned, any address to the Director, and the Prompt's working notes. Then run `node pipeline/poster.ts scenes/<id>/scene.json`, then `node pipeline/stub.ts scenes/<id>/scene.json`, then `node pipeline/check-scene.ts scenes/<id>/scene.json`. check-scene reports each hard check: every `generate` block resolved, `validate` green, the loop seam measured, the Poster equal to frame 0 of the plan, the stub and `gallery.json` current, and `npm test` passing.

When a check names a mechanical fix (run poster, run stub, or `music.ts --force` for an unmeasured seam), make it and run check-scene again. On any other failure, stop and report the failing checks: the Scene stays `draft` with its completed work kept, so a later run resumes at step 10.

**Done when** the `description` matches the generated Scene and `node pipeline/check-scene.ts scenes/<id>/scene.json` exits 0.

## 12. Preview

Start the dev server with `npm run dev` in the background unless something already listens on port 8000. Then run `node pipeline/preview.ts scenes/<id>/scene.json`: it runs the hard checks again, marks the Scene `resolved`, stages the Scene folder, new library files, any new Palette and `gallery.json`, and prints the report. Show the owner:

- the preview URL, and beside it the Tuner URL and command from `tuner`, for finishing the lighting by hand
- every local Element from `localElements`, each with an offer to regenerate it on the service at the `upgrade` price, generations and USD, the same way a paid retry is offered
- the staged files, with the files of each Primitive built at step 9 listed apart from the Scene's, so the owner can review that code on its own
- the cost block, beside the estimate from the Plan gate
- the ledger: the month's PixelLab generations and metered spend after this commit, against the 2,000-generation and £50 ceilings
- every abandoned Element and what happened to it (substituted, dropped or still only), offering a paid retry for each dropped one, and any cap that stopped generation
- the proposed commit message, plus one for each built Primitive to commit before the Scene

Then stop. Never commit or push: the owner does both.

**Done when** preview exited 0, its report is shown to the owner, and `git log` shows no commit made by this run.

## 13. Rejection

If the owner rejects the preview, change only what the owner named, under the same Scene id. If the owner takes a local Element's upgrade, run the `upgrade.command` preview printed (`reopen.ts <plan> --upgrade <placementId>`): it reopens the Placement as a service Finish under a fresh id, so the new Element is written beside the local one, which stays in the library for `orphans` to list. For Placements whose Element should change, run `node pipeline/reopen.ts scenes/<id>/scene.json <placementId...>`: it puts a `generate` block back on each with a fresh proposed id and marks the Scene `draft`. Apply the owner's edits to those blocks, rerun `derive-canvas` when a size changed, and run `validate`. For any other change, set `status: "draft"` first, then edit positions, Layers, Primitives or the Soundtrack in the plan directly, and rerun `music.ts --force` only when the owner rejects the music. If the owner names a Primitive built in this run, change its code by [primitives.md](primitives.md) until `npm test` passes again. Then run step 10 for the reopened Placements only, step 11 and step 12.

After a zoom Save in the Tuner, the Tuner has already reopened every Placement whose canvas changed and marked the Scene `draft`; it prints `/director resume <plan> at step 8`. Resume at step 8 for those reopened Placements only, then run step 10, step 11 and step 12.

**Done when** the owner accepts a preview or ends the session; every Placement the owner did not name keeps its Element.
