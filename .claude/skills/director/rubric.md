# Rubric and retry ladder

Every Attempt passes the Quality gate: the script's programmatic checks first, then this visual check of the 8x upscale. Any one point failing rejects the Attempt.

## Visual check

1. **Briefed subject only.** The Element shows what the brief names and nothing extra: no second object, no floor, no shadow blob.
2. **No engine motion painted in.** Nothing a Primitive or Frame strip supplies is baked into the still (see the ban list in briefs.md).
3. **Transparent openings where asked.** Panes, doorways and gaps the brief asked to be transparent are transparent.
4. **Structure intact.** Outlines are continuous, the shape is whole and readable, nothing is cut off at the canvas edge.
5. **House style.** Next to the Style anchor and the Elements already accepted for this Scene, it reads as the same hand.

## Still retry ladder

One rung per Attempt. Abandon after the fourth.

1. As written.
2. Resend unchanged (the seed is not deterministic).
3. Reword the brief to name the defect: "no shadow beneath", "panes fully transparent".
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
