# Rubric and retry ladder

Every Attempt passes the Quality gate: the script's programmatic checks first, then this visual check of the upscale. Any one point failing rejects the Attempt.

## Programmatic checks

The script fails an Attempt on any of these: dimensions other than the derived canvas; alpha other than 0 or 255; an opaque pixel off the Palette; for a prop or Feature, a trimmed opaque box outside 0.7x to 1.5x of the target box on either axis; for a Backdrop, any transparent pixel; for a Seamless texture, a last column that differs from the first. More than 2 disconnected islands is a warning. The report also gives the Orphan pixel count and share and the 2x2 checkerboard count: read them as pointers for the visual check, never as a pass mark.

The upscale (`scratch.upscale`) uses the largest whole factor that keeps the long side at or under 1,024 px, from 4x to 8x: small props at 8x, a 256 px Element at 4x.

## Visual check

1. **Briefed subject only.** The Element shows what the brief names and nothing extra: no second object, no floor, no shadow blob.
2. **No engine motion painted in.** Nothing a Primitive or Frame strip supplies is baked into the still (see the ban list in briefs.md).
3. **Transparent openings where asked.** Panes, doorways and gaps the brief asked to be transparent are transparent.
4. **Structure intact.** Outlines are continuous, the shape is whole and readable, nothing is cut off at the canvas edge. No Orphan pixels that read as noise and no jaggies along curves and diagonals; an eye, a highlight or a star is fine.
5. **House style.** Next to the Style anchor and the Elements already accepted for this Scene, it reads as the same hand.
6. **Shading.** Light comes from a mild top-down key. No pillow shading (dark bands following the outline), no banding (one-pixel clusters hugging each other or the outline), outlines darker than the fill they surround, no dithered regions or textured gradients.

## Backdrop check

A Backdrop is judged against this list instead of points 1 and 3:

- No window, frame, sill or curtain: the Opening and its frame belong to the room, not the view.
- No interior object: no furniture, plant or lamp.
- Nothing from the Style anchor's subject.
- It fills the canvas edge to edge, with no border, vignette or blank band.

## Still retry ladder

One rung per Attempt. Abandon after the fourth.

1. As written.
2. Resend unchanged (the seed is not deterministic).
3. Reword the brief to name the defect: "no shadow beneath", "panes fully transparent". On a trimmed-box fail, use the `retryBrief` the run printed, which adds "fills its canvas".
4. Change the decomposition: split the Element, merge it into a neighbour, or change its real size.

An abandoned Element is replaced by a library substitute (same subject, same Palette, same canvas size, already passing), or its Placement is dropped and the drop is reported.

## Strip retry ladder

- A 5xx or `inference_failed` is retried at once with a fresh idempotency key, up to 3 times.
- Identical frames or a drift failure: retry once with a new seed.
- A second drift failure on PixelLab: if the strip has more than 5 frames, retry once at 5 (PixelLab takes odd counts from 5 to 15).
- Then the Element falls back to its still.
- Retro Diffusion: at most 2 charged Attempts per prop and 4 props per Scene.

## Budget per Scene

4 Attempts per still, the PixelLab generation budget in cost.md, and $1.00 metered. Hitting any cap stops generation and is reported.
