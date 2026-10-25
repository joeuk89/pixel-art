# Building a Primitive

A Primitive is code, not a generated asset: building one costs nothing but spreads into the schema, the Viewer and the tests. Work test-first: add the fixture entry and the tests, watch them go red, then write the code.

## Name and schema

Name the type with one lowercase word for the motion it draws, used in the schema, the Viewer function and the tests alike. Add a `z.strictObject` to `primitiveSchema` in `schema/index.ts`, built from the helpers at the top of that file (`slug`, `region`, `point`, `colours`, `colourIndex`, `int`):

- `region` is in Scene coordinates, like every Primitive region.
- `anchor` is required when the Primitive acts on a Placement's pixels, and optional for free particles, where it only sets the Layer the Primitive draws after.
- Every tuning field has a default, so the plan only names what this Scene changes.
- Add a one-line comment only for what a field's name cannot say: its unit, its coordinate space, or the order its colours run in.

## Viewer

Write one function in `viewer/primitives.ts` that takes the parsed Primitive and the `Context` and returns a `PrimitiveDraw`, then add its case to `createPrimitives`. Follow the functions already there:

- **Deterministic**: draw from `random(seed, salt, …)` and `step(timeMs, fps)` alone, so any frame comes out byte-identical in any render order. Counter-based draws mean a frame never replays earlier ones.
- **fps**: `WEATHER_FPS` for particles that move across the Scene, `PROP_FPS` for effects on a prop.
- **Palette only**: write pixels with `paint` or `plotIn`, which take Palette indices. A Primitive draws only Palette colours; light belongs to the Variant's Lights.
- **Inside its region**: `plotIn` clips to it.
- **On the anchor's pixels**: find them with `eachPlacedPixel` and `sourceIndex`, which handle `tileX` and `flipX`.
- **state** is optional: two times with equal states must draw identical pixels. Return 0 while the Primitive draws nothing, so the Viewer can skip those steps.
- **Frame 0**: the Poster renders frame 0 without Primitives. Something that crosses the Scene, like a flight, enters from outside its region so it never appears from nowhere.

## Validate

`pipeline/validate.ts` checks every index in a field named `colours` against the Scene's Palette. A colour index in any other field needs its own case in `primitiveColours`.

## Tests

- Add an entry for the new type to `test/fixtures/primitives/scene.json` with every field set, and the type to `TYPES` in `test/primitives.test.ts`. That alone runs the shared tests: Palette colours only, byte-identical frames, and a different seed drawing differently.
- Write a test of its own for what the Primitive must and must not touch: its region, the anchor's colours, and anything special about time 0.
- Write a redraw-timing test against its fps and `state`, like the ones for the existing types.
- `npm test` then fails on each count of Primitive types that other tests hold. Update each one.

## Look

Render a few frames with the fixture into `scratch/` at 8x with sharp and open them with Read. A Primitive that passes its tests but reads wrong at Scene scale is not built: tune its defaults until it reads as the motion it names.

## Done

`npm test` passes and `node pipeline/validate.ts` exits 0. Stage the schema, Viewer, validate and test files with `git add`, and keep their list for the preview report.
