import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, symlinkSync } from "node:fs";
import { join } from "node:path";
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

  after(async () => {
    await browser?.close();
    if (server?.pid) process.kill(-server.pid);
  });

  async function open(path: string, options: BrowserContextOptions = {}): Promise<Watched> {
    const context = await browser!.newContext({ viewport: { width: 1000, height: 700 }, ...options });
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
});

function rgb(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
