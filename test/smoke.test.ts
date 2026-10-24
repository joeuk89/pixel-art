import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";
import sharp from "sharp";
import { chromium, type Browser, type BrowserContextOptions, type Page } from "playwright";
import { fixtureScene, makeTree, readJson, repo, runScript } from "./helpers.ts";

const id = "fixture-rainy-desk-a1b2";
const title = "Fixture rainy desk";

let browser: Browser | undefined;
try {
  browser = await chromium.launch();
} catch {
  browser = undefined;
}

after(async () => {
  await browser?.close();
});

function startDevServer(root: string): Promise<{ server: ChildProcess; url: string }> {
  const server = spawn("npm", ["run", "dev", "--", "--serve=127.0.0.1:0"], { cwd: root, detached: true, stdio: "pipe" });
  return new Promise((resolve, reject) => {
    let log = "";
    const onData = (chunk: Buffer) => {
      log += chunk;
      const match = log.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match) resolve({ server, url: match[1] });
    };
    server.stdout!.on("data", onData);
    server.stderr!.on("data", onData);
    server.on("exit", (code) => reject(new Error(`dev server exited with ${code}: ${log}`)));
  });
}

type Watched = { page: Page; errors: string[] };

describe("Viewer smoke test", { skip: browser ? false : "no Playwright browser installed" }, () => {
  let root: string;
  let server: ChildProcess;
  let site: string;
  let palette: string[];

  before(async () => {
    root = makeTree();
    for (const dir of ["viewer", "schema", "node_modules", "package.json"]) symlinkSync(join(repo, dir), join(root, dir));
    cpSync(join(repo, "index.html"), join(root, "index.html"));
    const staged = runScript(root, "stage", fixtureScene);
    assert.equal(staged.code, 0, staged.stderr);
    palette = readJson(root, "library/palettes/cosy-night.json").colours;
    ({ server, url: site } = await startDevServer(root));
  });

  after(() => {
    if (server?.pid) process.kill(-server.pid);
  });

  async function open(path: string, options: BrowserContextOptions = {}): Promise<Watched> {
    const context = await browser!.newContext({ viewport: { width: 1000, height: 700 }, ...options });
    await context.addInitScript(() => {
      const put = CanvasRenderingContext2D.prototype.putImageData;
      (window as any).draws = 0;
      CanvasRenderingContext2D.prototype.putImageData = function (this: CanvasRenderingContext2D, ...args: any[]) {
        (window as any).draws++;
        return (put as any).apply(this, args);
      };
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${m.text()} at ${m.location().url}`); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(site + path);
    return { page, errors };
  }

  test("the Gallery shows the fixture Scene's Poster and title", async () => {
    const { page, errors } = await open("");
    const card = page.getByRole("link", { name: title });
    await card.waitFor();
    const poster = card.getByRole("img", { name: title });
    await poster.waitFor();
    assert.equal(await poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), 192);
    assert.match(await card.innerText(), new RegExp(title));
    assert.match(await page.locator("footer").innerText(), /generated with AI/);
    assert.deepEqual(errors, []);
  });

  test("clicking a Poster opens the Scene in the same document and the canvas draws", async () => {
    const { page, errors } = await open("");
    await page.evaluate(() => { (window as any).sameDocument = true; });
    await page.getByRole("link", { name: title }).click();
    await page.waitForURL(`${site}scenes/${id}/`);
    const canvas = page.locator("canvas");
    await canvas.waitFor();
    assert.equal(await page.evaluate(() => (window as any).sameDocument), true);
    assert.equal(await page.title(), title);
    const pixels = await canvas.evaluate((c: HTMLCanvasElement) => {
      const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      const colours = new Set<number>();
      for (let i = 0; i < data.length; i += 4) colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      return { width: c.width, height: c.height, first: [data[0], data[1], data[2]], colours: colours.size };
    });
    assert.deepEqual([pixels.width, pixels.height], [192, 120]);
    assert.deepEqual(pixels.first, rgb(palette[1]));
    assert.ok(pixels.colours > 4, `canvas shows only ${pixels.colours} colours`);
    assert.deepEqual(errors, []);
  });

  test("cold-loading the Scene stub shows the Poster until the Elements decode, then the canvas", async () => {
    const context = await browser!.newContext({ viewport: { width: 1000, height: 700 } });
    const page = await context.newPage();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/library/elements/*.png", async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`${site}scenes/${id}/`);
    const poster = page.getByRole("img", { name: title });
    await poster.waitFor();
    assert.equal(await poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), 192);
    assert.equal(await page.locator("canvas").count(), 0);
    release();
    await page.locator("canvas").waitFor();
    assert.equal(await poster.count(), 0);
  });

  for (const size of [
    { viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, scale: 5 },
    { viewport: { width: 500, height: 900 }, deviceScaleFactor: 2, scale: 5 },
  ]) {
    test(`at ${size.viewport.width}x${size.viewport.height} @${size.deviceScaleFactor}x the canvas scale is the integer ${size.scale} and the letterbox is Palette index 0`, async () => {
      const { page, errors } = await open(`scenes/${id}/`, size);
      const canvas = page.locator("canvas");
      await canvas.waitFor();
      const box = (await canvas.boundingBox())!;
      assert.deepEqual(
        [box.width * size.deviceScaleFactor, box.height * size.deviceScaleFactor],
        [192 * size.scale, 120 * size.scale],
      );
      const { data, info } = await sharp(await page.screenshot()).raw().toBuffer({ resolveWithObject: true });
      const at = (x: number, y: number) => {
        const i = (y * info.width + x) * info.channels;
        return [data[i], data[i + 1], data[i + 2]];
      };
      assert.deepEqual(at(1, 1), rgb(palette[0]));
      assert.deepEqual(at(info.width - 2, info.height - 2), rgb(palette[0]));
      assert.deepEqual(errors, []);
    });
  }

  const draws = (page: Page): Promise<number> => page.evaluate(() => (window as any).draws);
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  test("with reduced motion the Poster stays and the draw loop never runs", async () => {
    const { page, errors } = await open(`scenes/${id}/`, { reducedMotion: "reduce" });
    const poster = page.getByRole("img", { name: title });
    await poster.waitFor();
    await pause(800);
    assert.ok(await poster.isVisible());
    assert.equal(await page.locator("canvas").count(), 0);
    assert.equal(await draws(page), 0);
    assert.deepEqual(errors, []);
  });

  test("drawing stops while the tab is hidden and resumes when it is visible again", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    await page.locator("canvas").waitFor();
    await pause(600);
    assert.ok((await draws(page)) > 1, "the Scene is not animating");

    const setVisibility = (hidden: boolean) =>
      page.evaluate((hidden) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
        document.dispatchEvent(new Event("visibilitychange"));
      }, hidden);

    await setVisibility(true);
    const hiddenAt = await draws(page);
    await pause(800);
    assert.equal(await draws(page), hiddenAt);

    await setVisibility(false);
    await pause(800);
    assert.ok((await draws(page)) > hiddenAt + 1, "drawing did not resume");
    assert.deepEqual(errors, []);
  });

  test("an unknown Scene id shows No such Scene with a link back to the Gallery", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    await page.locator("canvas").waitFor();
    await page.evaluate(() => history.pushState(null, "", "../no-such-scene/"));
    await page.goBack();
    await page.goForward();
    await page.getByRole("heading", { name: "No such Scene" }).waitFor();
    assert.equal(page.url(), `${site}scenes/no-such-scene/`);
    await page.getByRole("link", { name: /Gallery/ }).click();
    await page.getByRole("link", { name: title }).waitFor();
    assert.equal(page.url(), site);
    assert.deepEqual(errors.filter((e) => !e.endsWith(`at ${site}scenes/no-such-scene/scene.json`)), []);
  });
});

const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".md": "text/markdown" };

function servePages(dist: string, prefix: string): Promise<{ pages: Server; url: string }> {
  const pages = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url!, "http://pages").pathname);
    let file = path.startsWith(prefix) ? join(dist, normalize(path.slice(prefix.length))) : "";
    if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!file || !file.startsWith(dist) || !existsSync(file)) {
      res.writeHead(404).end("Not Found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  return new Promise((resolve) => pages.listen(0, "127.0.0.1", () => {
    resolve({ pages, url: `http://127.0.0.1:${(pages.address() as AddressInfo).port}${prefix}` });
  }));
}

describe("Published site", { skip: browser ? false : "no Playwright browser installed" }, () => {
  const SITE = "https://joeuk89.github.io/pixel-art/";
  let root: string;
  let pages: Server;
  let site: string;

  before(async () => {
    root = makeTree();
    for (const dir of ["viewer", "schema", "node_modules", "package.json"]) symlinkSync(join(repo, dir), join(root, dir));
    cpSync(join(repo, "index.html"), join(root, "index.html"));
    writeFileSync(join(root, "NOTICE.md"), readFileSync(join(repo, "NOTICE.md")));
    assert.equal(runScript(root, "stage", fixtureScene).code, 0);
    const bundle = spawnSync("npm", ["run", "bundle"], { cwd: root, encoding: "utf8" });
    assert.equal(bundle.status, 0, bundle.stderr);
    const assembled = runScript(root, "assemble");
    assert.equal(assembled.code, 0, assembled.stderr);
    ({ pages, url: site } = await servePages(join(root, "dist"), "/pixel-art/"));
  });

  after(() => {
    pages?.close();
  });

  test("dist/ served under /pixel-art/ shows the Gallery and opens the Scene with crisp pixels", async () => {
    const page = await browser!.newPage({ viewport: { width: 1000, height: 700 } });
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(site);
    const card = page.getByRole("link", { name: title });
    await card.getByRole("img", { name: title }).waitFor();
    await card.click();
    await page.waitForURL(`${site}scenes/${id}/`);
    const canvas = page.locator("canvas");
    await canvas.waitFor();
    assert.equal(await canvas.evaluate((c) => getComputedStyle(c).imageRendering), "pixelated");
    assert.deepEqual(errors, []);
  });

  test("the published Scene stub cold-loads and carries Share link preview tags that resolve", async () => {
    const page = await browser!.newPage({ viewport: { width: 1000, height: 700 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${site}scenes/${id}/`);
    await page.locator("canvas").waitFor();
    const og = (property: string) => page.locator(`meta[property="${property}"]`).getAttribute("content");
    assert.equal(await og("og:title"), title);
    assert.equal(await og("og:url"), `${SITE}scenes/${id}/`);
    const image = (await og("og:image"))!;
    assert.ok(image.startsWith(SITE), image);
    const local = await fetch(site + image.slice(SITE.length));
    assert.equal(local.status, 200);
    const { width, height } = await sharp(Buffer.from(await local.arrayBuffer())).metadata();
    assert.deepEqual([width, height], [768, 480]);
    assert.deepEqual(errors, []);
  });

  test("nothing outside the published folders is served", async () => {
    for (const path of ["prototypes/", "docs/adr/0002-scene-share-links.md", "pipeline/stage.ts", "schema/index.ts", "package.json"]) {
      assert.equal((await fetch(site + path)).status, 404, path);
    }
  });
});

function rgb(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
