import { createServer, type IncomingHttpHeaders } from "node:http";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { fal } from "./fixtures/services/fal.ts";
import { freesound } from "./fixtures/services/freesound.ts";
import { gemini } from "./fixtures/services/gemini.ts";
import { pixellab } from "./fixtures/services/pixellab.ts";
import { retroDiffusion } from "./fixtures/services/retro-diffusion.ts";
import { stability } from "./fixtures/services/stability.ts";

export type FixtureRequest = {
  service: string;
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: Buffer;
};

export type FixtureReply = { status?: number; json?: unknown; body?: Buffer; type?: string; headers?: Record<string, string> };

export type ServiceFixture = {
  name: string;
  env: (base: string) => Record<string, string>;
  handle: (req: FixtureRequest, base: string) => FixtureReply | undefined | Promise<FixtureReply | undefined>;
};

export const serviceFixtures: ServiceFixture[] = [freesound, stability, gemini, fal, pixellab, retroDiffusion];

export type FixtureServer = {
  url: string;
  env: Record<string, string>;
  requests: FixtureRequest[];
  close: () => Promise<void>;
};

export async function startFixtureServer(): Promise<FixtureServer> {
  const requests: FixtureRequest[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const url = new URL(req.url ?? "/", "http://fixture");
    const [, name, ...rest] = url.pathname.split("/");
    const fixture = serviceFixtures.find((f) => f.name === name);
    const request: FixtureRequest = {
      service: name, method: req.method ?? "GET", path: `/${rest.join("/")}`, query: url.searchParams,
      headers: req.headers, body: Buffer.concat(chunks),
    };
    requests.push(request);
    const reply = (await fixture?.handle(request, `${base}/${name}`)) ?? { status: 404, json: { error: `no fixture for ${url.pathname}` } };
    const body = reply.json !== undefined ? Buffer.from(JSON.stringify(reply.json)) : (reply.body ?? Buffer.alloc(0));
    res.writeHead(reply.status ?? 200, {
      "content-type": reply.json !== undefined ? "application/json" : (reply.type ?? "application/octet-stream"),
      ...reply.headers,
    });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const env = Object.assign({}, ...serviceFixtures.map((f) => f.env(`${base}/${f.name}`)));
  return {
    url: base,
    env,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

export type ScriptRun = { code: number | null; stdout: string; stderr: string; json: any };

const SERVICE_ENV = /_(BASE_URL|API_KEY)$|^FAL_KEY$/;

export function runScript(script: string, args: string[], opts: { cwd: string; env: Record<string, string | undefined> }): Promise<ScriptRun> {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SERVICE_ENV.test(k)));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...inherited, ...opts.env })) if (v !== undefined) env[k] = v;
  const child = spawn(process.execPath, [script, ...args], { cwd: opts.cwd, env });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      let json: any;
      try { json = JSON.parse(stdout); } catch { json = undefined; }
      resolve({ code, stdout, stderr, json });
    });
  });
}
