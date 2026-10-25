import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import sharp from "sharp";
import { ROOM_FILE, SCENE_HEIGHT, SCENE_WIDTH, type ElementRecord } from "../schema/index.ts";
import { firstAttemptGenerations, type Canvas } from "./lib/canvas.ts";
import { readElements, readScene } from "./lib/library.ts";
import { loadPalette } from "./lib/element-pixels.ts";
import type { Pixels } from "./lib/pixel-ops.ts";
import { roomShellOf } from "./lib/room-shell.ts";
import { standInFeature, standInImage, type StandInImage, type StandInSuffix } from "./lib/stand-in.ts";
import { applyTuning, TuningRefused } from "./lib/tuning.ts";
import { zoomIssue, zoomScene, type Zoomed } from "./lib/zoom.ts";

const root = process.cwd();
const here = dirname(fileURLToPath(import.meta.url));
const bundleDir = join(root, "scratch/tuner");
const DEFAULT_PORT = 8001;
const TYPES: Record<string, string> = { ".json": "application/json", ".png": "image/png", ".js": "text/javascript", ".html": "text/html; charset=utf-8" };

type Args = { file: string; port: number; open: boolean };

function parseArgs(argv: string[]): Args {
  const usage = "usage: tune <scene.json> [--port <n>] [--no-open]";
  let file: string | undefined;
  let port = DEFAULT_PORT;
  let open = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port") port = Number(argv[++i]);
    else if (argv[i] === "--no-open") open = false;
    else if (!file && !argv[i].startsWith("--")) file = argv[i];
    else throw new Error(usage);
  }
  if (!file || !Number.isInteger(port) || port < 0) throw new Error(usage);
  return { file, port, open };
}

type Run = { code: number | null; out: any };

function runScript(script: string, ...args: string[]): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(here, `${script}.ts`), ...args], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("close", (code) => {
      let out: any;
      try {
        out = JSON.parse(stdout);
      } catch {
        out = { ok: false, error: `${script} printed no report` };
      }
      done({ code, out });
    });
  });
}

class ZoomRefused extends Error {}

function zoomFrom(url: URL): number | undefined {
  const text = url.searchParams.get("zoom");
  if (text === null) return undefined;
  const zoom = Number(text);
  const issue = zoomIssue(zoom);
  if (issue) throw new ZoomRefused(issue);
  return zoom;
}

const pngOf = (p: Pixels) => sharp(p.data, { raw: { width: p.width, height: p.height, channels: 4 } }).png().toBuffer();

function writeAtomically(path: string, text: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

function send(res: ServerResponse, status: number, body: string | Buffer, type: string): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

const json = (res: ServerResponse, status: number, value: unknown) => send(res, status, JSON.stringify(value), TYPES[".json"]);

async function body(req: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text;
}

const PAGE = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tuner</title>
<body>
<script type="module" src="tuner.js"></script>
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const planPath = resolve(root, args.file);
  const file = relative(root, planPath);
  const roomPath = join(dirname(planPath), ROOM_FILE);
  const plan = readScene(planPath);
  const palette = loadPalette(root, plan.palette);
  const records = () => new Map<string, ElementRecord>(readElements(root).map((r) => [r.id, r]));
  const zoomed = (zoom: number, library = records()) => zoomScene(JSON.parse(readFileSync(planPath, "utf8")), zoom, library);

  mkdirSync(bundleDir, { recursive: true });
  await build({ entryPoints: [join(here, "tuner/page.ts")], bundle: true, format: "esm", outfile: join(bundleDir, "tuner.js"), logLevel: "silent" });

  const saveZoom = async (z: Zoomed) => {
    writeAtomically(planPath, JSON.stringify(z.raw, null, 2) + "\n");
    const failures: string[] = [];
    const run = async (script: string, ...args: string[]) => {
      const done = await runScript(script, ...args);
      if (done.code !== 0) failures.push(`${script} ${args.slice(1).join(" ")}: ${done.out.error ?? (done.out.gate?.failed ?? []).join("; ")}`.trim());
      return done;
    };
    const reopenIds = [...z.reopen.service, ...z.reopen.local];
    const reopened = reopenIds.length > 0
      ? await run("reopen", file, ...reopenIds, ...Object.entries(z.reopen.sizes).flatMap(([id, c]) => ["--size", `${id}=${c.width}x${c.height}`]))
      : undefined;
    const redrawn: { placement: string; element: string }[] = [];
    if (reopened?.code === 0) {
      for (const id of z.reopen.local) {
        const attempt = await run("draw-element", file, id);
        if (attempt.code !== 0) continue;
        if (!attempt.out.gate.ok) {
          failures.push(`draw-element ${id}: the redraw failed the Quality gate (${attempt.out.gate.failed.join("; ")}), so it stays reopened`);
          continue;
        }
        const accepted = await run("draw-element", file, id, "--accept", attempt.out.scratch.png);
        if (accepted.code === 0) redrawn.push({ placement: id, element: accepted.out.element });
      }
    }
    if (z.plan.layers.some((l) => l.kind === "room")) await run("room-shell", file);
    const projected = await run("project-features", file);
    const raw = JSON.parse(readFileSync(planPath, "utf8"));
    if (raw.status !== "draft") {
      raw.status = "draft";
      writeAtomically(planPath, JSON.stringify(raw, null, 2) + "\n");
    }
    const after = new Map(z.placements.map((p) => [p.placement, p.after]));
    const estimate = z.reopen.service.map((id) => {
      const canvas = after.get(id) as Canvas;
      return { placement: id, canvas, generations: firstAttemptGenerations(canvas) };
    });
    const pending = reopenIds.filter((id) => !redrawn.some((r) => r.placement === id));
    const report = {
      ok: failures.length === 0,
      zoom: z.zoom,
      stage: z.plan.stage,
      status: "draft",
      reopened: reopened?.code === 0 ? reopenIds : [],
      proposed: reopened?.out.proposed ?? {},
      redrawn,
      removed: z.removed,
      features: (projected.out.features ?? []).map((f: { placement: string }) => f.placement),
      estimate: { generations: estimate.reduce((sum, e) => sum + e.generations, 0), firstAttempt: estimate },
      resume: `/director resume ${file} at step 8 for ${pending.join(", ") || "no reopened Placement"}`,
      ...(failures.length > 0 && { error: failures.join("; ") }),
    };
    process.stdout.write(JSON.stringify(report) + "\n");
    return report;
  };

  const sendPng = async (res: ServerResponse, image: StandInImage) => {
    res.writeHead(200, { "content-type": TYPES[".png"], "cache-control": "no-store", "x-stand-in": image.kind });
    res.end(await pngOf(image.pixels));
  };

  let saving = false;
  const save = async (req: IncomingMessage, res: ServerResponse) => {
    if (saving) return json(res, 409, { ok: false, error: "a Save is already running" });
    saving = true;
    try {
      let payload: unknown;
      try {
        payload = JSON.parse(await body(req));
      } catch {
        return json(res, 400, { ok: false, error: "the Save is not JSON" });
      }
      const zoom = (payload as { zoom?: unknown } | null)?.zoom;
      if (zoom !== undefined) {
        const issue = zoomIssue(zoom);
        if (issue) return json(res, 400, { ok: false, error: issue });
      }
      let tuned;
      let zoomedPlan: Zoomed | undefined;
      try {
        tuned = applyTuning(readFileSync(planPath, "utf8"), payload, palette);
        if (zoom !== undefined && zoom !== 1) zoomedPlan = zoomScene(JSON.parse(tuned.text), zoom as number, records());
      } catch (e) {
        if (e instanceof TuningRefused) return json(res, 400, { ok: false, error: `the plan would be invalid: ${e.message}` });
        if (zoom !== undefined) return json(res, 400, { ok: false, error: `the zoomed plan would be invalid: ${(e as Error).message}` });
        throw e;
      }
      if (zoomedPlan) return json(res, 200, await saveZoom(zoomedPlan));
      writeAtomically(planPath, tuned.text);
      const poster = tuned.defaultChanged ? await runScript("poster", file) : undefined;
      const posterFailed = poster !== undefined && poster.code !== 0;
      const preview = await runScript("preview", file);
      const failed = (preview.out.checks ?? []).filter((c: { ok: boolean }) => !c.ok);
      return json(res, 200, {
        ok: preview.code === 0 && !posterFailed,
        poster: tuned.defaultChanged,
        ...(posterFailed && { error: `poster failed: ${poster.out.error}` }),
        status: readScene(planPath).status,
        preview: {
          ok: preview.code === 0,
          ...(preview.out.error && { error: preview.out.error }),
          failed: failed.map((c: { name: string }) => c.name),
          problems: failed.flatMap((c: { problems: string[] }) => c.problems),
          staged: preview.out.staged ?? [],
        },
      });
    } finally {
      saving = false;
    }
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://tuner");
      const path = decodeURIComponent(url.pathname);
      if (req.method === "POST" && path === "/save") return await save(req, res);
      if (req.method !== "GET") return json(res, 405, { ok: false, error: `${req.method} is not allowed` });
      if (path === "/") return send(res, 200, PAGE, TYPES[".html"]);
      if (path === "/tuner.js") return send(res, 200, readFileSync(join(bundleDir, "tuner.js")), TYPES[".js"]);
      if (path === "/scene.json") return send(res, 200, readFileSync(planPath), TYPES[".json"]);
      if (path === "/zoom.json") {
        const z = zoomed(zoomFrom(url) ?? 1);
        return json(res, 200, { ok: true, zoom: z.zoom, plan: z.raw, placements: z.placements, removed: z.removed });
      }
      if (path === `/${ROOM_FILE}` && url.searchParams.has("zoom")) {
        const z = zoomed(zoomFrom(url)!);
        return send(res, 200, await pngOf({ width: SCENE_WIDTH, height: SCENE_HEIGHT, data: new Uint8Array(roomShellOf(z.plan, palette).buffer) }), TYPES[".png"]);
      }
      const standIn = path.match(/^\/stand-in\/(features\/)?([a-z0-9-]+)(\.png|\.strip\.png|\.emissive\.png)$/);
      if (standIn) {
        const [, projected, placementId, suffix] = standIn;
        const library = records();
        const z = zoomed(zoomFrom(url) ?? 1, library);
        const entry = z.placements.find((p) => p.placement === placementId);
        const record = entry && library.get(entry.element);
        const image = !record ? undefined
          : projected ? (suffix === ".png" ? await standInFeature(root, z, placementId, record, palette) : undefined)
          : await standInImage(root, z, placementId, suffix as StandInSuffix, record, palette);
        if (image) return await sendPng(res, image);
        return json(res, 404, { ok: false, error: `no stand-in ${path}` });
      }
      if (path === `/${ROOM_FILE}` && existsSync(roomPath)) return send(res, 200, readFileSync(roomPath), TYPES[".png"]);
      const feature = path.match(/^\/features\/([a-z0-9-]+\.png)$/);
      const featurePath = feature && join(dirname(planPath), "features", feature[1]);
      if (featurePath && existsSync(featurePath)) return send(res, 200, readFileSync(featurePath), TYPES[".png"]);
      if (path.startsWith("/library/")) {
        const target = resolve(root, `.${path}`);
        const library = join(root, "library") + sep;
        if (target.startsWith(library) && existsSync(target) && TYPES[extname(target)]) return send(res, 200, readFileSync(target), TYPES[extname(target)]);
      }
      json(res, 404, { ok: false, error: `${path} not found` });
    } catch (e) {
      if (e instanceof ZoomRefused) return json(res, 400, { ok: false, error: e.message });
      json(res, 500, { ok: false, error: (e as Error).message });
    }
  });
  await new Promise<void>((done) => server.listen(args.port, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  process.stdout.write(JSON.stringify({ ok: true, scene: plan.id, url }) + "\n");
  if (args.open) spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
}

main().catch((e) => {
  process.stderr.write((e as Error).message + "\n");
  process.stdout.write(JSON.stringify({ ok: false, error: (e as Error).message }) + "\n");
  process.exitCode = 1;
});
