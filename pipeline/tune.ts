import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readScene } from "./lib/library.ts";
import { loadPalette } from "./lib/element-pixels.ts";
import { applyTuning, TuningRefused } from "./lib/tuning.ts";

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

function runScript(script: string, file: string): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(here, `${script}.ts`), file], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
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
  const plan = readScene(planPath);
  const palette = loadPalette(root, plan.palette);

  mkdirSync(bundleDir, { recursive: true });
  await build({ entryPoints: [join(here, "tuner/page.ts")], bundle: true, format: "esm", outfile: join(bundleDir, "tuner.js"), logLevel: "silent" });

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
      let tuned;
      try {
        tuned = applyTuning(readFileSync(planPath, "utf8"), payload, palette);
      } catch (e) {
        if (e instanceof TuningRefused) return json(res, 400, { ok: false, error: `the plan would be invalid: ${e.message}` });
        throw e;
      }
      writeAtomically(planPath, tuned.text);
      if (tuned.defaultChanged) {
        const poster = await runScript("poster", file);
        if (poster.code !== 0) return json(res, 200, { ok: false, poster: true, error: `poster failed: ${poster.out.error}` });
      }
      const preview = await runScript("preview", file);
      const failed = (preview.out.checks ?? []).filter((c: { ok: boolean }) => !c.ok);
      return json(res, 200, {
        ok: preview.code === 0,
        poster: tuned.defaultChanged,
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
      const path = decodeURIComponent(new URL(req.url ?? "/", "http://tuner").pathname);
      if (req.method === "POST" && path === "/save") return await save(req, res);
      if (req.method !== "GET") return json(res, 405, { ok: false, error: `${req.method} is not allowed` });
      if (path === "/") return send(res, 200, PAGE, TYPES[".html"]);
      if (path === "/tuner.js") return send(res, 200, readFileSync(join(bundleDir, "tuner.js")), TYPES[".js"]);
      if (path === "/scene.json") return send(res, 200, readFileSync(planPath), TYPES[".json"]);
      if (path.startsWith("/library/")) {
        const target = resolve(root, `.${path}`);
        const library = join(root, "library") + sep;
        if (target.startsWith(library) && existsSync(target) && TYPES[extname(target)]) return send(res, 200, readFileSync(target), TYPES[extname(target)]);
      }
      json(res, 404, { ok: false, error: `${path} not found` });
    } catch (e) {
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
