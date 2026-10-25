import { isWall, roomLayerOf, SCENE_HEIGHT, SCENE_WIDTH, surfaceSchema, type Opening, type Palette, type RoomLayer, type ScenePlan, type Stage, type Surface } from "../../schema/index.ts";
import { locate, project, surfaceExtent } from "./perspective.ts";
import { rgbOf } from "./pixel-ops.ts";

const MIN_LINE_GAP = 3;
// Boards are 64 px long on 6 px rows; the stagger keeps joints in neighbouring rows from lining up.
const BOARD_LENGTH_PER_ROW = 64 / 6;
const STAGGER = (row: number) => ((row * 23 + 7) % 64) / 64;

const PLAIN = 1, TRIM = 2;
type Line = { from: [number, number]; to: [number, number] };

function inFrame(o: Opening, along: number, across: number): boolean {
  if (!o.frame) return false;
  const { width, mullionsAcross, mullionsDown } = o.frame;
  const a = along - o.along, c = across - o.across;
  if (a < width || a >= o.w - width || c < width || c >= o.h - width) return true;
  const onBar = (at: number, span: number, bars: number) => {
    const pane = (span - 2 * width - bars * width) / (bars + 1);
    for (let i = 0; i < bars; i++) {
      const start = width + (i + 1) * pane + i * width;
      if (at >= start && at < start + width) return true;
    }
    return false;
  };
  return onBar(a, o.w, mullionsAcross) || onBar(c, o.h, mullionsDown);
}

const inside = (o: Opening, along: number, across: number) =>
  along >= o.along && along < o.along + o.w && across >= o.across && across < o.across + o.h;

function* bresenham([x0, y0]: [number, number], [x1, y1]: [number, number]): Generator<[number, number]> {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  for (;;) {
    yield [x0, y0];
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}

// Lines of one family on a Surface: constant across (measured on screen by y) or constant along (by x). A line within
// MIN_LINE_GAP px of the last one drawn is dropped, so detail thins out with depth instead of aliasing.
function family(stage: Stage, surface: Surface, constant: "along" | "across", spacing: number, doubled: boolean): { lines: Line[]; drawn: number[] } {
  const extent = surfaceExtent(stage, surface);
  const other = constant === "along" ? "across" : "along";
  const at = (c: number, t: number): [number, number] => {
    const p = constant === "along" ? project(stage, surface, c, t) : project(stage, surface, t, c);
    return [p.x, p.y];
  };
  const lines: Line[] = [];
  const drawn: number[] = [];
  let last = -Infinity;
  for (let c = 0; c < extent[constant]; c += spacing) {
    const start = at(c, 0);
    const pos = Math.round(constant === "along" ? start[0] : start[1]);
    if (Math.abs(pos - last) < MIN_LINE_GAP) continue;
    last = pos;
    drawn.push(c);
    lines.push({ from: start, to: at(c, extent[other]) });
    if (doubled && c + 1 < extent[constant]) lines.push({ from: at(c + 1, 0), to: at(c + 1, extent[other]) });
  }
  return { lines, drawn };
}

function boardJoints(stage: Stage, surface: Surface, rows: number[], spacing: number): Line[] {
  const length = spacing * BOARD_LENGTH_PER_ROW;
  const width = surfaceExtent(stage, surface).along;
  return rows.flatMap((across) => {
    const joints: Line[] = [];
    for (let u = STAGGER(Math.round(across / spacing)) * length; u < width; u += length) {
      const a = project(stage, surface, u, across), b = project(stage, surface, u, across + spacing);
      joints.push({ from: [a.x, a.y], to: [b.x, b.y] });
    }
    return joints;
  });
}

function linesOf(stage: Stage, surface: Surface, lines: NonNullable<RoomLayer["surfaces"][Surface]>["lines"]): Line[] {
  if (!lines) return [];
  const { pattern, spacing } = lines;
  const rows = family(stage, surface, "across", spacing, pattern === "coffers");
  if (pattern === "boards") return [...rows.lines, ...boardJoints(stage, surface, rows.drawn, spacing)];
  return [...rows.lines, ...family(stage, surface, "along", spacing, pattern === "coffers").lines];
}

export function drawRoomShell(stage: Stage, room: RoomLayer, palette: Palette): Uint8ClampedArray {
  const rgb = palette.colours.map(rgbOf);
  const darker = (colour: number) => palette.ramps?.[colour]?.dark ?? colour;
  const out = new Uint8ClampedArray(SCENE_WIDTH * SCENE_HEIGHT * 4);
  const kind = new Uint8Array(SCENE_WIDTH * SCENE_HEIGHT);
  const surfaceAt = new Int8Array(SCENE_WIDTH * SCENE_HEIGHT).fill(-1);
  const paint = (p: number, colour: number) => {
    out.set(rgb[colour], p * 4);
    out[p * 4 + 3] = 255;
  };

  for (let y = 0; y < SCENE_HEIGHT; y++) {
    for (let x = 0; x < SCENE_WIDTH; x++) {
      const at = locate(stage, x, y);
      const style = at && room.surfaces[at.surface];
      if (!at || !style) continue;
      const p = y * SCENE_WIDTH + x;
      const opening = room.openings.find((o) => o.surface === at.surface && inside(o, at.along, at.across));
      if (opening) {
        if (inFrame(opening, at.along, at.across)) {
          paint(p, opening.frame!.colour);
          kind[p] = TRIM;
        }
        continue;
      }
      const skirting = isWall(at.surface) ? style.skirting : undefined;
      if (skirting && at.across >= stage.back.h - skirting.height) {
        paint(p, skirting.colour);
        kind[p] = TRIM;
        continue;
      }
      paint(p, style.colour);
      kind[p] = PLAIN;
      surfaceAt[p] = surfaceSchema.options.indexOf(at.surface);
    }
  }

  surfaceSchema.options.forEach((surface, si) => {
    const style = room.surfaces[surface];
    if (!style) return;
    const colour = darker(style.colour);
    for (const { from, to } of linesOf(stage, surface, style.lines)) {
      for (const [x, y] of bresenham(from, to)) {
        if (x < 0 || y < 0 || x >= SCENE_WIDTH || y >= SCENE_HEIGHT) continue;
        const p = y * SCENE_WIDTH + x;
        if (kind[p] === PLAIN && surfaceAt[p] === si) paint(p, colour);
      }
    }
  });
  return out;
}

export function roomShellOf(plan: ScenePlan, palette: Palette): Uint8ClampedArray {
  const room = roomLayerOf(plan);
  if (!room) throw new Error(`Scene ${plan.id} has no room Layer to draw`);
  if (!plan.stage) throw new Error(`Scene ${plan.id} has no Stage to draw its room Layer from`);
  return drawRoomShell(plan.stage, room, palette);
}
