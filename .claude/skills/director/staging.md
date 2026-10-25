# Staging

A v2 Scene is a space the viewer stands in. The Stage gives it depth: a back rectangle, a vanishing point and a viewing distance `f`. Floor props are sized by how far back they stand, and the local pixel engine draws the Room shell from the Stage.

## The Stage and the zoom

Run `node pipeline/derive-stage.ts --room <w>x<h>x<d> --eye <m> --zoom <z>` with the Concept's space and eye height; outdoors, add `--outdoors` and pass the ground width and depth with the horizon height as `h`. Copy its `stage` and `scale` into the plan unchanged.

Use zoom 1.0, or 1.25 when the focal point sits on the back wall (an Opening or a back-wall Feature), so it leads; never above 1.5. At 1.0 the back wall fills the canvas width, so side walls show only below 1.0. When side walls show, keep each at least 12 px wide at the canvas edge. The owner can try other zooms later in the Tuner.

## Layers across the Planes

Use three to six Layers covering the far, mid and near Planes, in that order:

- far: the sky and what lies beyond the room, Backdrops and far skylines
- mid: the room and everything in it
- near: one large prop cut by a canvas edge, such as a curtain or a plant, to frame the Scene

Stage an interior as a `room` Layer or a doorway (a near wall Element with a transparent cut-out). A subject at two depths is two Elements.

## The Room shell

The `room` Layer lists the Surfaces it draws; a Surface left out is not drawn. Take each Surface's colours and `lines` from the Concept's materials: `boards` for a wood floor, `coffers` or `grid` for a ceiling, no lines for plaster. Give walls skirting where the room would have it.

Size Openings at real metre sizes: a door about 2 m tall, a floor-to-ceiling window the room's full height, converted with the back-wall `scale`. Openings are rectangles in their Surface's own coordinates (`along` and `across` in back-wall pixels from the Surface's corner), each with a frame and mullions where the window has them.

## Backdrops and skylines

A Backdrop sized to the Opening it shows through is generated once at that `size` and placed to fill it exactly; with no Opening, size it to the region of the canvas it covers. It is never tiled.

A skyline built from props takes at least three distinct Elements per row, with varied heights, `flipX` and uneven spacing, so no building repeats beside itself.

## Floor props

Floor props take a `foot` position: the bottom centre of the prop, on the floor polygon `derive-stage` prints. The Scale at the foot sizes the prop, so a chair further back is a smaller Element. The Viewer draws nearer feet over further ones.

## Bare Surfaces

Every drawn Surface carries at least one Feature or Opening, and no Surface shows more than about a third of the canvas bare. Nothing measures this: it is judged by eye at the Plan gate and the preview. When it fails, change the zoom or add Features until it holds.
