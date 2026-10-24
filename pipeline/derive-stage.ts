import { parseArgs } from "node:util";
import { DEFAULT_STAGE_F, SCENE_HEIGHT, SCENE_WIDTH, type Stage } from "../schema/index.ts";
import { main } from "./lib/cli.ts";
import { depthOf, floorPolygon } from "./lib/perspective.ts";

const USAGE = "usage: derive-stage --room <w>x<h>x<d> --eye <m> [--zoom <z>] [--f <px>] [--outdoors]";
const FLOOR_BAND = SCENE_HEIGHT / 4;
const round2 = (n: number) => Math.round(n * 100) / 100;

function positive(name: string, value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got ${value}`);
  return n;
}

main(() => {
  const { values } = parseArgs({
    options: {
      room: { type: "string" },
      eye: { type: "string" },
      zoom: { type: "string", default: "1" },
      f: { type: "string", default: String(DEFAULT_STAGE_F) },
      outdoors: { type: "boolean", default: false },
    },
  });
  if (values.room === undefined || values.eye === undefined) throw new Error(USAGE);
  const sides = values.room.split("x");
  if (sides.length !== 3) throw new Error(`--room must be <w>x<h>x<d> in metres, got ${values.room}`);
  const [w, h, d] = sides.map((side) => positive("--room", side));
  const eye = positive("--eye", values.eye);
  const zoom = positive("--zoom", values.zoom);
  const f = round2(positive("--f", values.f) * zoom);
  const { outdoors } = values;
  if (!outdoors && eye >= h) throw new Error(`eye height ${eye} m is not below the ${h} m ceiling`);

  // At 1.0x the back wall fills the canvas width and is centred vertically when it leaves at least FLOOR_BAND of floor;
  // a taller wall keeps that band and crops its ceiling. The vanishing point sits at eye height on its centre line.
  const scale1 = SCENE_WIDTH / w;
  const midX = SCENE_WIDTH / 2;
  const floor1 = Math.min(Math.round((SCENE_HEIGHT + h * scale1) / 2), SCENE_HEIGHT - FLOOR_BAND);
  const top1 = Math.round(floor1 - h * scale1);
  const vp = { x: midX, y: Math.round(floor1 - eye * scale1) };
  if (vp.y >= floor1) throw new Error(`eye height ${eye} m puts the vanishing point on the floor line: raise it`);
  if (vp.y < 0) {
    throw new Error(`the vanishing point at y ${vp.y} falls above the canvas: lower the eye height or widen the room`);
  }

  // Zoom walks the camera forward: the 1.0x Stage scales about the vanishing point, so the Tuner's zoom gives the same Stage.
  const scale = scale1 * zoom;
  const zx = (x: number) => Math.round(vp.x + (x - vp.x) * zoom), zy = (y: number) => Math.round(vp.y + (y - vp.y) * zoom);
  const x0 = zx(0), x1 = zx(SCENE_WIDTH), y0 = zy(top1), y1 = zy(floor1);
  if (y1 >= SCENE_HEIGHT) {
    throw new Error(`at ${zoom}x the floor line at y ${y1} is not above the canvas bottom at ${SCENE_HEIGHT}: zoom out`);
  }
  const stage: Stage = { back: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, vanishingPoint: vp, f };

  const nearest = (SCENE_HEIGHT - vp.y) / (y1 - vp.y);
  const floorDepthShown = round2(depthOf(f, nearest) / scale);
  return {
    room: { w, h, d },
    eye,
    zoom,
    outdoors,
    stage,
    scale: round2(scale),
    ...(outdoors ? { horizon: y0 } : {}),
    floorDepthShown,
    floorPolygon: floorPolygon(stage).map((p) => ({ x: round2(p.x), y: round2(p.y) })),
  };
});
