import { parseArgs } from "node:util";
import { DEFAULT_STAGE_F, SCENE_HEIGHT, SCENE_WIDTH, type Stage } from "../schema/index.ts";
import { main } from "./lib/cli.ts";
import { floorPolygon } from "./lib/perspective.ts";

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

  // The back wall fills the canvas width and is centred vertically when it leaves at least FLOOR_BAND of floor;
  // a taller wall keeps that band and crops its ceiling. The vanishing point sits at eye height on its centre line.
  const scale = (SCENE_WIDTH * zoom) / w;
  const midX = SCENE_WIDTH / 2;
  const x0 = Math.round(midX * (1 - zoom)), x1 = Math.round(midX + (SCENE_WIDTH - midX) * zoom);
  const y1 = Math.min(Math.round((SCENE_HEIGHT + h * scale) / 2), SCENE_HEIGHT - FLOOR_BAND);
  const y0 = Math.round(y1 - h * scale);
  const vp = { x: midX, y: Math.round(y1 - eye * scale) };
  if (vp.y >= y1) throw new Error(`eye height ${eye} m puts the vanishing point on the floor line: raise it`);
  if (vp.y < 0) {
    throw new Error(`the vanishing point at y ${vp.y} falls above the canvas: lower the eye height, widen the room or zoom out`);
  }
  const stage: Stage = { back: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, vanishingPoint: vp, f };

  const nearest = (SCENE_HEIGHT - vp.y) / (y1 - vp.y);
  const floorDepthShown = round2((f * (1 - 1 / nearest)) / scale);
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
