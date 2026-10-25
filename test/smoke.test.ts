import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";
import sharp from "sharp";
import { build } from "esbuild";
import { chromium, devices, type Browser, type BrowserContextOptions, type Page } from "playwright";
import { SITE_URL } from "../pipeline/lib/site.ts";
import { editJson, fixturePalette, fixtureScene, makeTree, readJson, repo, runScript, writeJson } from "./helpers.ts";

const id = "fixture-rainy-desk-a1b2";
const title = "Fixture rainy desk";
const quietId = "fixture-quiet-desk-c3d4";
const stillId = "fixture-still-desk-e5f6";

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
    const bed = readJson(root, "library/ambient/freesound-room-tone-641306.json");
    for (const [id, brief] of [["elevenlabs-kettle-01", "kettle hiss"], ["elevenlabs-wind-01", "distant wind"]]) {
      writeJson(root, `library/ambient/${id}.json`, { ...bed, id, brief });
    }
    editJson(root, fixtureScene, (plan) => {
      plan.soundtrack.ambient.push(
        { source: { kind: "generated", service: "elevenlabs-fal", brief: "kettle hiss", id: "elevenlabs-kettle-01" }, file: "room.ogg", distance: "near" },
        { source: { kind: "generated", service: "elevenlabs-fal", brief: "distant wind", id: "elevenlabs-wind-01" }, file: "thunder.ogg", distance: "far", gain: 0.5 },
      );
      plan.variants[1].soundtrack = { ambient: [{ source: { kind: "curated", id: "freesound-vent-hum-753540" }, file: "room.ogg", distance: "near" }] };
    });
    const quiet = `scenes/${quietId}`;
    cpSync(join(root, `scenes/${id}`), join(root, quiet), { recursive: true });
    editJson(root, `${quiet}/scene.json`, (plan) => {
      Object.assign(plan, { id: quietId, title: "Fixture quiet desk" });
      Object.assign(plan.soundtrack, { ambient: [], oneshots: [] });
      for (const variant of plan.variants) delete variant.soundtrack;
    });
    const still = `scenes/${stillId}`;
    cpSync(join(root, `scenes/${id}`), join(root, still), { recursive: true });
    editJson(root, `${still}/scene.json`, (plan) => {
      Object.assign(plan, { id: stillId, title: "Fixture still desk", primitives: [], variants: plan.variants.slice(0, 1) });
      for (const p of plan.layers.flatMap((l: any) => l.placements ?? [])) if (p.animation) p.animation.enabled = false;
      for (const light of plan.variants[0].lights) delete light.flicker;
    });
    for (const scene of [`${quiet}/scene.json`, `${still}/scene.json`, fixtureScene]) {
      const staged = runScript(root, "stub", scene);
      assert.equal(staged.code, 0, staged.stderr);
    }
    palette = readJson(root, `library/palettes/${fixturePalette}.json`).colours;
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
      const request = Element.prototype.requestFullscreen;
      (window as any).fullscreenRequests = 0;
      Element.prototype.requestFullscreen = function (this: Element, ...args: any[]) {
        (window as any).fullscreenRequests++;
        return (request as any).apply(this, args);
      };
      const audio = { contexts: [] as AudioContext[], edges: [] as [AudioNode, AudioNode][], starts: [] as any[] };
      (window as any).audio = audio;
      const Context = AudioContext;
      (window as any).AudioContext = class extends Context {
        constructor(...args: any[]) {
          super(...args);
          audio.contexts.push(this);
        }
      };
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (this: AudioNode, destination: any, ...rest: any[]) {
        if (destination instanceof AudioNode) audio.edges.push([this, destination]);
        return (connect as any).call(this, destination, ...rest);
      } as any;
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, when = 0, offset = 0, ...rest: any[]) {
        audio.starts.push({ node: this, when, offset, now: this.context.currentTime });
        return (start as any).call(this, when, offset, ...rest);
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
    const shown = await poster.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const box = img.getBoundingClientRect();
      return { natural: [img.naturalWidth, img.naturalHeight], device: [box.width * devicePixelRatio, box.height * devicePixelRatio] };
    });
    assert.deepEqual(shown.natural, [384, 240]);
    const scale = shown.device[0] / 384;
    assert.ok(Number.isInteger(scale) && scale >= 1, `the Poster shows at ${shown.device[0]} device px, not a whole multiple of 384`);
    assert.equal(shown.device[1], 240 * scale);
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
    assert.deepEqual([pixels.width, pixels.height], [384, 240]);
    assert.deepEqual(pixels.first, rgb(palette[1]), "the left wall's colour 3 is two dark steps down under the rainy night");
    assert.ok(pixels.colours > 4, `canvas shows only ${pixels.colours} colours`);
    assert.deepEqual(errors, []);
  });

  test("the Scene draws lit under its default Variant, as the lit Poster shows it", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    const canvas = page.locator("canvas");
    await canvas.waitFor();
    const window = { x: 168, y: 28, w: 48, h: 3 };
    const drawn = await canvas.evaluate((c: HTMLCanvasElement, r) => Array.from(c.getContext("2d")!.getImageData(r.x, r.y, r.w, r.h).data), window);
    const poster = await sharp(join(root, `scenes/${id}/poster.png`)).extract({ left: window.x, top: window.y, width: window.w, height: window.h }).raw().toBuffer();
    const element = await sharp(join(root, "library/elements/window-wood-transparent-panes-01.png")).extract({ left: 0, top: 0, width: window.w, height: window.h }).raw().toBuffer();
    assert.deepEqual(drawn, Array.from(poster), "the window frame differs from the lit Poster");
    let unlit = 0;
    for (let i = 0; i < drawn.length; i += 4) if (drawn[i] === element[i] && drawn[i + 1] === element[i + 1] && drawn[i + 2] === element[i + 2]) unlit++;
    assert.equal(unlit, 0, `${unlit} window frame pixels show the Element's own colour`);

    const city = { x: 64, y: 84, w: 90, h: 80 };
    const yellow = rgb(palette[8]);
    const lights = await canvas.evaluate((c: HTMLCanvasElement, [r, colour]) => {
      const data = c.getContext("2d")!.getImageData(r.x, r.y, r.w, r.h).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] === colour[0] && data[i + 1] === colour[1] && data[i + 2] === colour[2]) n++;
      return n;
    }, [city, yellow] as const);
    assert.ok(lights > 0, "no emissive city window inside the mask kept its colour");
    assert.deepEqual(errors, []);
  });

  test("the room Layer draws the Room shell from room.png, as the Poster shows it", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    const canvas = page.locator("canvas");
    await canvas.waitFor();
    // Back wall below the Opening, out of reach of the flickering lamp and the Primitives.
    const wall = { x: 64, y: 196, w: 86, h: 10 };
    const drawn = await canvas.evaluate((c: HTMLCanvasElement, r) => Array.from(c.getContext("2d")!.getImageData(r.x, r.y, r.w, r.h).data), wall);
    const poster = await sharp(join(root, `scenes/${id}/poster.png`)).ensureAlpha().extract({ left: wall.x, top: wall.y, width: wall.w, height: wall.h }).raw().toBuffer();
    assert.deepEqual(drawn, Array.from(poster));
    const shell = readJson(root, fixtureScene).layers.find((l: any) => l.kind === "room");
    assert.equal(shell.openings.length, 1);
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
    const audioFetched: string[] = [];
    page.on("request", (r) => { if (/\.(mp3|ogg)$/.test(r.url())) audioFetched.push(r.url()); });
    await page.goto(`${site}scenes/${id}/`);
    const poster = page.getByRole("img", { name: title });
    await poster.waitFor();
    assert.equal(await poster.evaluate(async (img: HTMLImageElement) => (await img.decode(), img.naturalWidth)), 384);
    assert.equal(await page.locator("canvas").count(), 0);
    await pause(300);
    assert.deepEqual(audioFetched, [], "audio loaded before the visuals");
    release();
    await page.locator("canvas").waitFor();
    assert.equal(await poster.count(), 0);
  });

  for (const size of [
    { viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1, scale: 2 },
    { viewport: { width: 500, height: 900 }, deviceScaleFactor: 2, scale: 2 },
    { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, scale: 4 },
  ]) {
    test(`at ${size.viewport.width}x${size.viewport.height} @${size.deviceScaleFactor}x the canvas scale is the integer ${size.scale} and the letterbox is Palette index 0`, async () => {
      const { page, errors } = await open(`scenes/${id}/`, size);
      const canvas = page.locator("canvas");
      await canvas.waitFor();
      const box = (await canvas.boundingBox())!;
      assert.deepEqual(
        [box.width * size.deviceScaleFactor, box.height * size.deviceScaleFactor],
        [384 * size.scale, 240 * size.scale],
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

  test("with reduced motion the lit Poster, Halo and all, stays and the draw loop never runs", async () => {
    const { page, errors } = await open(`scenes/${id}/`, { reducedMotion: "reduce" });
    const poster = page.getByRole("img", { name: title });
    await poster.waitFor();
    await pause(800);
    assert.ok(await poster.isVisible());
    assert.equal(await page.locator("canvas").count(), 0);
    assert.equal(await draws(page), 0);
    const shown = await poster.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    });
    const lit = await sharp(join(root, `scenes/${id}/poster.png`)).ensureAlpha().raw().toBuffer();
    assert.ok(Buffer.from(shown).equals(lit), "the Poster shown is not the lit Poster");
    const lamp = readJson(root, fixtureScene).variants[0].lights.find((l: any) => l.halo);
    const onPalette = new Set(palette.map((h) => rgb(h).join()));
    let glowing = 0;
    for (let i = 0; i < shown.length; i += 4) if (!onPalette.has(shown.slice(i, i + 3).join())) glowing++;
    assert.ok(glowing > 0, `the Poster shows no Halo from ${lamp.id}`);
    assert.deepEqual(errors, []);
  });

  test("a steady Scene draws once, then nothing, visible or hidden", async () => {
    const { page, errors } = await open(`scenes/${stillId}/`);
    await page.locator("canvas").waitFor();
    await pause(800);
    assert.equal(await draws(page), 1, "a Scene with nothing moving drew again");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await pause(500);
    assert.equal(await draws(page), 1, "a hidden steady Scene drew");
    assert.deepEqual(errors, []);
  });

  test("24 lit frames with rain and a flickering Halo average under 20 ms each in Chromium", async () => {
    const plan = readJson(root, fixtureScene);
    assert.ok(plan.primitives.some((p: any) => p.type === "rain"), "the fixture Scene has no rain");
    assert.ok(plan.variants[0].lights.some((l: any) => l.halo && l.flicker), "the fixture Scene has no flickering Halo");
    writeFileSync(join(root, "frame-time.ts"), FRAME_TIME);
    await build({ entryPoints: [join(root, "frame-time.ts")], bundle: true, format: "esm", outfile: join(root, "frame-time.js"), logLevel: "silent" });
    const { page, errors } = await open(`scenes/${id}/`);
    await page.locator("canvas").waitFor();
    const mean = await page.evaluate(async (scene) => {
      const { frameTime } = await import("/frame-time.js" as string);
      return frameTime(scene) as Promise<number>;
    }, id);
    assert.ok(mean < 20, `mean frame time ${mean.toFixed(2)} ms`);
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

  test("the Scene plan's rain animates inside its window region on the canvas", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    const canvas = page.locator("canvas");
    await canvas.waitFor();
    const { region } = readJson(root, fixtureScene).primitives.find((p: any) => p.type === "rain");
    const rainRegion = () =>
      canvas.evaluate((c: HTMLCanvasElement, r) => Array.from(c.getContext("2d")!.getImageData(r.x, r.y, r.w, r.h).data).join(","), region);
    const first = await rainRegion();
    let changed = false;
    for (let k = 0; k < 10 && !changed; k++) {
      await pause(100);
      changed = (await rainRegion()) !== first;
    }
    assert.ok(changed, "the rain region never changed");
    assert.deepEqual(errors, []);
  });

  test("the cat's Frame strip animates at its Placement on the canvas", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    const canvas = page.locator("canvas");
    await canvas.waitFor();
    const { foot } = readJson(root, fixtureScene).layers.flatMap((l: any) => l.placements ?? []).find((p: any) => p.id === "cat");
    const at = { x: foot.x - 12, y: foot.y - 16 };
    const cat = () => canvas.evaluate((c: HTMLCanvasElement, p) => Array.from(c.getContext("2d")!.getImageData(p.x, p.y, 24, 16).data).join(","), at);
    const first = await cat();
    let changed = false;
    for (let k = 0; k < 10 && !changed; k++) {
      await pause(100);
      changed = (await cat()) !== first;
    }
    assert.ok(changed, "the cat never moved");
    assert.deepEqual(errors, []);
  });

  test("the overlay appears on pointer move and hides itself after a few seconds", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    await page.locator("canvas").waitFor();
    const back = page.getByRole("link", { name: "Back to the Gallery" });
    assert.equal(await back.isVisible(), false);
    await page.mouse.move(300, 300);
    await page.mouse.move(310, 305);
    await back.waitFor({ state: "visible" });
    assert.equal(await page.getByText(title, { exact: true }).isVisible(), true);
    for (const name of ["Sound", "Copy link", "Info"]) assert.ok(await page.getByRole("button", { name }).isVisible(), name);
    await back.waitFor({ state: "hidden", timeout: 6000 });
    assert.deepEqual(errors, []);
  });

  test("a tap shows the overlay", async () => {
    const { page, errors } = await open(`scenes/${id}/`, { hasTouch: true });
    await page.locator("canvas").waitFor();
    await page.touchscreen.tap(500, 350);
    await page.getByRole("link", { name: "Back to the Gallery" }).waitFor({ state: "visible" });
    assert.deepEqual(errors, []);
  });

  type Route = { loop: boolean; loopStart: number; loopEnd: number; duration: number; offset: number; delay: number; rate: number; gain: number; filters: string[]; reachesOutput: boolean };

  const routes = (page: Page): Promise<Route[]> =>
    page.evaluate(() => {
      const { edges, starts } = (window as any).audio as { edges: [AudioNode, AudioNode][]; starts: any[] };
      return starts.map(({ node, when, offset, now }) => {
        let gain = 1;
        const filters: string[] = [];
        let at: AudioNode = node;
        for (let next = edges.find(([from]) => from === at); next; next = edges.find(([from]) => from === at)) {
          at = next[1];
          if (at instanceof GainNode) gain *= at.gain.value;
          if (at instanceof BiquadFilterNode) filters.push(`${at.type} ${at.frequency.value}`);
        }
        const source = node as AudioBufferSourceNode;
        return {
          loop: source.loop, loopStart: source.loopStart, loopEnd: source.loopEnd, duration: source.buffer!.duration,
          offset, delay: when - now, rate: source.playbackRate.value, gain: Math.round(gain * 1e6) / 1e6, filters,
          reachesOutput: at instanceof AudioDestinationNode,
        };
      });
    });

  test("music loops at the plan's loop points on its gain and each Ambient loop plays through its Distance bus", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    await page.locator("canvas").waitFor();
    await page.waitForFunction(() => (window as any).audio.starts.length >= 5);
    const all = await routes(page);
    assert.equal(all.length, 5);
    assert.ok(all.every((r) => r.reachesOutput), "a source does not reach the output");
    const loops = all.filter((r) => r.loop);
    const music = loops.filter((r) => r.loopEnd === 2);
    assert.equal(music.length, 1);
    assert.deepEqual([music[0].loopStart, music[0].gain, music[0].filters], [0, 0.6, []]);
    const ambient = loops.filter((r) => r !== music[0]).map(({ gain, filters }) => ({ gain, filters }));
    assert.deepEqual(new Set(ambient.map((a) => JSON.stringify(a))), new Set([
      JSON.stringify({ gain: 0.7, filters: [] }),
      JSON.stringify({ gain: 0.35, filters: ["lowpass 5000"] }),
      JSON.stringify({ gain: 0.075, filters: ["lowpass 1200"] }),
    ]));
    for (const r of loops.filter((r) => r !== music[0])) assert.ok(r.offset >= 0 && r.offset < r.duration, `offset ${r.offset}`);
    const [thunder] = all.filter((r) => !r.loop);
    assert.ok(thunder.delay >= 90, `the first One-shot fires after ${thunder.delay} s`);
    assert.deepEqual(thunder.filters, ["lowpass 1200"]);
    assert.ok(thunder.gain >= 0.15 * 10 ** -0.1 && thunder.gain <= 0.15 * 10 ** 0.1, `One-shot gain ${thunder.gain}`);
    assert.ok(thunder.rate >= 0.97 && thunder.rate <= 1.03, `One-shot rate ${thunder.rate}`);
    assert.deepEqual(errors, []);
  });

  const audioState = (page: Page) => page.evaluate(() => {
    const [context] = (window as any).audio.contexts as AudioContext[];
    return { contexts: (window as any).audio.contexts.length, state: context.state, time: context.currentTime };
  });

  test("the audio context stays suspended while muted, runs after the first click, keeps running while the tab is hidden and suspends on mute", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    await page.locator("canvas").waitFor();
    await page.waitForFunction(() => (window as any).audio.starts.length >= 5);
    assert.deepEqual((({ contexts, state }) => ({ contexts, state }))(await audioState(page)), { contexts: 1, state: "suspended" });
    await page.mouse.click(500, 400);
    await page.waitForFunction(() => (window as any).audio.contexts[0].state === "running");

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const hiddenAt = (await audioState(page)).time;
    await pause(600);
    const hidden = await audioState(page);
    assert.equal(hidden.state, "running");
    assert.ok(hidden.time > hiddenAt + 0.3, `the audio clock moved ${hidden.time - hiddenAt} s while hidden`);

    await page.keyboard.press("m");
    await page.waitForFunction(() => (window as any).audio.contexts[0].state === "suspended");
    assert.equal((await audioState(page)).contexts, 1);
    assert.deepEqual(errors, []);
  });

  const soundOn = (page: Page) => page.getByRole("button", { name: "Sound", includeHidden: true }).getAttribute("aria-pressed");

  test("M toggles the muted flag and the click-for-sound hint goes after the first unmute", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    await page.locator("canvas").waitFor();
    const hint = page.getByText("Click for sound");
    assert.equal(await hint.isVisible(), true);
    assert.equal(await soundOn(page), "false");
    await page.keyboard.press("m");
    assert.equal(await soundOn(page), "true");
    assert.equal(await hint.isVisible(), false);
    await page.keyboard.press("M");
    assert.equal(await soundOn(page), "false");
    assert.equal(await hint.isVisible(), false);
    assert.deepEqual(errors, []);
  });

  test("the first click anywhere unmutes and the sound toggle mutes again", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    await page.locator("canvas").waitFor();
    await page.mouse.click(500, 400);
    assert.equal(await soundOn(page), "true");
    assert.equal(await page.getByText("Click for sound").isVisible(), false);
    await page.getByRole("button", { name: "Sound" }).click();
    assert.equal(await soundOn(page), "false");
    assert.equal(await page.evaluate(() => document.fullscreenElement), null);
    assert.deepEqual(errors, []);
  });

  const channelLevels = (page: Page) =>
    page.evaluate(() => {
      const { edges } = (window as any).audio as { edges: [AudioNode, AudioNode][] };
      return edges
        .filter(([, to]) => to instanceof AudioDestinationNode)
        .map(([from]) => Math.round((from as GainNode).gain.value * 1000) / 1000);
    });

  test("the Music and Ambient sliders sit beside the Sound button, each with a visible label", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    await page.locator("canvas").waitFor();
    await page.mouse.move(300, 300);
    for (const name of ["Music", "Ambient"]) {
      const slider = page.getByRole("slider", { name, exact: true });
      assert.equal(await slider.getAttribute("aria-label"), name);
      assert.equal(await slider.inputValue(), "1");
      assert.equal(await slider.isEnabled(), true);
      assert.equal(await page.locator("label", { has: slider }).innerText(), name);
    }
    const row = await page.locator(".overlay").evaluate((nav) =>
      [...nav.children].map((el) => el.querySelector("input")?.getAttribute("aria-label") ?? el.textContent));
    assert.deepEqual(row.slice(1, 7), [title, "Rainy night", "Sound", "Music", "Ambient", "Fullscreen"]);
    assert.equal(await page.getByRole("slider", { name: "Volume" }).count(), 0);
    assert.deepEqual(errors, []);
  });

  test("sound on and both sliders survive a reload, an old volume is ignored, and sound off brings the hint back", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    await page.locator("canvas").waitFor();
    await page.evaluate(() => localStorage.setItem("pixel-art:volume", "0.1"));
    await page.reload();
    await page.locator("canvas").waitFor();
    await page.keyboard.press("m");
    await page.mouse.move(300, 300);
    const music = page.getByRole("slider", { name: "Music", exact: true, includeHidden: true });
    const ambient = page.getByRole("slider", { name: "Ambient", exact: true, includeHidden: true });
    assert.deepEqual(await channelLevels(page), [1, 1]);
    await music.fill("0.4");
    await ambient.fill("0.75");
    assert.deepEqual(await channelLevels(page), [0.4, 0.75]);

    await page.reload();
    await page.locator("canvas").waitFor();
    assert.equal(await soundOn(page), "true");
    assert.equal(await page.getByText("Click for sound").isVisible(), false);
    assert.equal(await music.inputValue(), "0.4");
    assert.equal(await ambient.inputValue(), "0.75");
    assert.deepEqual(await channelLevels(page), [0.4, 0.75]);
    await page.mouse.click(500, 400);
    assert.equal(await soundOn(page), "true");
    await page.waitForFunction(() => (window as any).audio.contexts[0].state === "running");

    await page.keyboard.press("m");
    await page.reload();
    await page.locator("canvas").waitFor();
    assert.equal(await soundOn(page), "false");
    assert.equal(await page.getByText("Click for sound").isVisible(), true);
    assert.equal(await page.evaluate(() => (window as any).audio.contexts[0].state), "suspended");
    assert.equal(await music.inputValue(), "0.4");
    assert.deepEqual(errors, []);
  });

  test("a Scene with no Ambient loops or One-shots shows the Ambient slider disabled", async () => {
    const { page, errors } = await open(`scenes/${quietId}/`);
    await page.locator("canvas").waitFor();
    await page.mouse.move(300, 300);
    const ambient = page.getByRole("slider", { name: "Ambient", exact: true });
    await ambient.waitFor({ state: "visible", timeout: 2000 });
    assert.equal(await ambient.isDisabled(), true);
    assert.equal(await page.getByRole("slider", { name: "Music", exact: true }).isEnabled(), true);
    assert.deepEqual(errors, []);
  });

  const fullscreenRequests = (page: Page): Promise<number> => page.evaluate(() => (window as any).fullscreenRequests);
  const isFullscreen = (page: Page) => page.evaluate(() => document.fullscreenElement !== null);

  test("F requests fullscreen and unmutes, F again leaves fullscreen", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    await page.locator("canvas").waitFor();
    await page.keyboard.press("f");
    assert.equal(await fullscreenRequests(page), 1);
    assert.equal(await soundOn(page), "true");
    await page.waitForFunction(() => document.fullscreenElement !== null);
    await page.keyboard.press("m");
    assert.equal(await soundOn(page), "false");
    await page.keyboard.press("f");
    await page.waitForFunction(() => document.fullscreenElement === null);
    assert.equal(await fullscreenRequests(page), 1);
    assert.equal(await soundOn(page), "false");
    await page.keyboard.press("f");
    await page.waitForFunction(() => document.fullscreenElement !== null);
    assert.equal(await fullscreenRequests(page), 2);
    assert.equal(await soundOn(page), "false");
    assert.deepEqual(errors, []);
  });

  test("the fullscreen button requests fullscreen and unmutes", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    await page.locator("canvas").waitFor();
    await page.mouse.move(300, 300);
    await page.getByRole("button", { name: "Fullscreen" }).click();
    assert.equal(await fullscreenRequests(page), 1);
    assert.equal(await soundOn(page), "true");
    assert.deepEqual(errors, []);
  });

  test("Esc does nothing while fullscreen and returns to the Gallery with pushState otherwise", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    await page.locator("canvas").waitFor();
    await page.evaluate(() => { (window as any).sameDocument = true; });
    await page.keyboard.press("f");
    await page.waitForFunction(() => document.fullscreenElement !== null);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await pause(200);
    assert.equal(page.url(), `${site}scenes/${id}/`);
    assert.equal(await page.locator("canvas").count(), 1);
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => document.fullscreenElement === null);
    assert.equal(await isFullscreen(page), false);
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: title }).waitFor();
    assert.equal(page.url(), site);
    assert.equal(await page.evaluate(() => (window as any).sameDocument), true);
    assert.deepEqual(errors, []);
  });

  test("on an iPhone the fullscreen button is absent, F does nothing and the Scene fills the viewport", async () => {
    const { page, errors } = await open(`scenes/${id}/`, devices["iPhone 13"]);
    await page.locator("canvas").waitFor();
    await page.touchscreen.tap(100, 100);
    await page.getByRole("button", { name: "Sound" }).waitFor({ state: "visible" });
    assert.equal(await page.getByRole("button", { name: "Fullscreen", includeHidden: true }).count(), 0);
    await page.keyboard.press("f");
    assert.equal(await fullscreenRequests(page), 0);
    const viewport = page.viewportSize()!;
    const scene = (await page.locator("main").boundingBox())!;
    assert.deepEqual([scene.x, scene.y, scene.width, scene.height], [0, 0, viewport.width, viewport.height]);
    const canvas = (await page.locator("canvas").boundingBox())!;
    assert.ok(canvas.width <= viewport.width && canvas.height <= viewport.height);
    assert.ok(canvas.width >= viewport.width / 2, `canvas is ${canvas.width}px wide in a ${viewport.width}px viewport`);
    assert.deepEqual(errors, []);
  });

  const windowFrame = { x: 168, y: 28, w: 48, h: 3 };
  const frameOnCanvas = (page: Page) =>
    page.locator("canvas").evaluate((c: HTMLCanvasElement, r) => Array.from(c.getContext("2d")!.getImageData(r.x, r.y, r.w, r.h).data), windowFrame);
  const frameOnPoster = async () =>
    Array.from(await sharp(join(root, `scenes/${id}/poster.png`)).extract({ left: windowFrame.x, top: windowFrame.y, width: windowFrame.w, height: windowFrame.h }).raw().toBuffer());
  const variantButton = (page: Page) => page.locator(".overlay button.variant");
  const variantShown = (page: Page, title: string) =>
    page.waitForFunction((t) => document.querySelector(".overlay button.variant")?.textContent === t, title);
  const sourcesStarted = (page: Page) => page.evaluate(() => (window as any).audio.starts.length as number);

  test("the Variant control switches to the second Variant, relights the canvas, pushes ?variant= and fades in its loop", async () => {
    const { page, errors } = await open(`scenes/${id}/`, { permissions: ["clipboard-read", "clipboard-write"] });
    await page.locator("canvas").waitFor();
    await page.evaluate(() => { (window as any).sameDocument = true; });
    await page.waitForFunction(() => (window as any).audio.starts.length >= 5);
    const rainy = await frameOnCanvas(page);
    assert.deepEqual(rainy, await frameOnPoster());
    await page.mouse.move(300, 300);
    const control = variantButton(page);
    assert.equal(await control.textContent(), "Rainy night");
    await control.click();
    await page.waitForURL(`${site}scenes/${id}/?variant=clear-night`);
    await variantShown(page, "Clear night");
    await page.waitForFunction((before) => (window as any).audio.starts.length > before, 5);
    assert.equal(await sourcesStarted(page), 6, "the Variant's loop did not start once");
    await page.waitForFunction(([r, before]) => {
      const c = document.querySelector("canvas")!;
      return Array.from(c.getContext("2d")!.getImageData(r.x, r.y, r.w, r.h).data).join() !== before;
    }, [windowFrame, rainy.join()] as const);
    assert.equal(await page.locator("canvas").count(), 1);
    assert.equal(await page.evaluate(() => (window as any).sameDocument), true);

    await page.getByRole("button", { name: "Copy link" }).click();
    await page.getByRole("button", { name: "Copied" }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${site}scenes/${id}/?variant=clear-night`);

    await page.keyboard.press("v");
    await page.waitForURL(`${site}scenes/${id}/`);
    await variantShown(page, "Rainy night");
    assert.deepEqual(errors, []);
  });

  test("opening ?variant= draws that Variant directly and Back after a switch returns to the default", async () => {
    const { page, errors } = await open(`scenes/${id}/?variant=clear-night`);
    await page.locator("canvas").waitFor();
    await variantShown(page, "Clear night");
    const clear = await frameOnCanvas(page);
    assert.notDeepEqual(clear, await frameOnPoster(), "the clear night draws like the rainy night");
    await page.waitForFunction(() => (window as any).audio.starts.length >= 6);

    await page.keyboard.press("v");
    await page.waitForURL(`${site}scenes/${id}/`);
    await page.waitForFunction(([r, before]) => {
      const c = document.querySelector("canvas")!;
      return Array.from(c.getContext("2d")!.getImageData(r.x, r.y, r.w, r.h).data).join() !== before;
    }, [windowFrame, clear.join()] as const);
    assert.deepEqual(await frameOnCanvas(page), await frameOnPoster());

    await page.route("**/scene.json", async (route) => {
      await pause(300);
      await route.continue();
    });
    await page.goBack();
    await page.waitForURL(`${site}scenes/${id}/?variant=clear-night`);
    await variantShown(page, "Clear night");
    await page.waitForFunction(([r, after]) => {
      const c = document.querySelector("canvas");
      return c !== null && Array.from(c.getContext("2d")!.getImageData(r.x, r.y, r.w, r.h).data).join() === after;
    }, [windowFrame, clear.join()] as const);
    assert.deepEqual(errors, []);
  });

  test("an unknown ?variant= plays the default Variant", async () => {
    const { page, errors } = await open(`scenes/${id}/?variant=snowy-dawn`);
    await page.locator("canvas").waitFor();
    await variantShown(page, "Rainy night");
    assert.deepEqual(await frameOnCanvas(page), await frameOnPoster());
    assert.deepEqual(errors, []);
  });

  test("a one-Variant Scene hides the Variant control and V does nothing", async () => {
    const { page, errors } = await open(`scenes/${stillId}/`);
    await page.locator("canvas").waitFor();
    await page.mouse.move(300, 300);
    assert.equal(await variantButton(page).isHidden(), true);
    await page.keyboard.press("v");
    await pause(200);
    assert.equal(page.url(), `${site}scenes/${stillId}/`);
    assert.deepEqual(errors, []);
  });

  test("Copy link writes the Scene's Share link to the clipboard", async () => {
    const { page, errors } = await open("", { permissions: ["clipboard-read", "clipboard-write"] });
    await page.getByRole("link", { name: title }).click();
    await page.locator("canvas").waitFor();
    await page.mouse.move(300, 300);
    await page.getByRole("button", { name: "Copy link" }).click();
    await page.getByRole("button", { name: "Copied" }).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${site}scenes/${id}/`);
    assert.deepEqual(errors, []);
  });

  test("I opens the info panel with the Description, the AI notice naming every service and one attribution line per curated sound", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    await page.locator("canvas").waitFor();
    const info = page.getByRole("region", { name: "About this Scene" });
    assert.equal(await info.count(), 0);
    await page.keyboard.press("i");
    await info.waitFor();
    const text = await info.innerText();
    assert.match(text, /A cosy desk by a rainy window at night, with a cat asleep in the lamplight\./);
    assert.doesNotMatch(text, /a cosy desk by a rainy window at night, cat asleep/);
    await info.getByText("Artwork, music and sound effects generated with AI using PixelLab, Stable Audio 3.0 and ElevenLabs.").waitFor();
    const lines = info.getByRole("listitem");
    assert.equal(await lines.count(), 3);
    for (const [n, record] of ["freesound-room-tone-641306", "freesound-thunder-distant-195522", "freesound-vent-hum-753540"].entries()) {
      const { attribution, licence, sourceUrl } = readJson(root, `library/ambient/${record}.json`);
      const line = lines.nth(n);
      assert.match(await line.innerText(), new RegExp(`${escape(attribution)}.*${escape(licence)}`));
      assert.equal(await line.getByRole("link", { name: attribution }).getAttribute("href"), sourceUrl);
    }
    await page.keyboard.press("i");
    await info.waitFor({ state: "detached" });
    assert.equal(await soundOn(page), "false");
    assert.deepEqual(errors, []);
  });

  test("the Info button opens the panel and its close button shuts it", async () => {
    const { page, errors } = await open(`scenes/${id}/`);
    await page.locator("canvas").waitFor();
    await page.mouse.move(300, 300);
    await page.getByRole("button", { name: "Info" }).click();
    const info = page.getByRole("region", { name: "About this Scene" });
    await info.waitFor();
    await info.getByRole("button", { name: "Close" }).click();
    await info.waitFor({ state: "detached" });
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
  let root: string;
  let pages: Server;
  let site: string;

  before(async () => {
    root = makeTree();
    for (const dir of ["viewer", "schema", "node_modules", "package.json"]) symlinkSync(join(repo, dir), join(root, dir));
    cpSync(join(repo, "index.html"), join(root, "index.html"));
    writeFileSync(join(root, "NOTICE.md"), readFileSync(join(repo, "NOTICE.md")));
    assert.equal(runScript(root, "stub", fixtureScene).code, 0);
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
    assert.equal(await og("og:url"), `${SITE_URL}scenes/${id}/`);
    const image = (await og("og:image"))!;
    assert.ok(image.startsWith(SITE_URL), image);
    const local = await fetch(site + image.slice(SITE_URL.length));
    assert.equal(local.status, 200);
    const { width, height } = await sharp(Buffer.from(await local.arrayBuffer())).metadata();
    assert.deepEqual([width, height], [768, 480]);
    assert.deepEqual(errors, []);
  });

  test("nothing outside the published folders is served", async () => {
    for (const path of ["prototypes/", "docs/adr/0002-scene-share-links.md", "pipeline/stub.ts", "schema/index.ts", "package.json"]) {
      assert.equal((await fetch(site + path)).status, 404, path);
    }
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rgb(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

const FRAME_TIME = `
import { elementRecordSchema, paletteSchema, scenePlanSchema, allPlacements, roomLayerOf, SCENE_WIDTH, SCENE_HEIGHT } from "./schema/index.ts";
import { createCompositor, elementPixelsOf } from "./viewer/compositor.ts";
import { createPrimitives } from "./viewer/primitives.ts";

async function decode(url) {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  return { width: bitmap.width, height: bitmap.height, data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data };
}

export async function frameTime(id) {
  const json = async (path) => (await fetch("/" + path)).json();
  const plan = scenePlanSchema.parse(await json("scenes/" + id + "/scene.json"));
  const palette = paletteSchema.parse(await json("library/palettes/" + plan.palette + ".json"));
  const elements = new Map();
  for (const element of new Set(allPlacements(plan).map((p) => p.element))) {
    const record = elementRecordSchema.parse(await json("library/elements/" + element + ".json"));
    elements.set(element, await elementPixelsOf(record, (suffix) => decode("/library/elements/" + element + suffix)));
  }
  const room = roomLayerOf(plan) ? await decode("/scenes/" + id + "/room.png") : undefined;
  const compositor = createCompositor({ plan, elements, palette, room, primitives: createPrimitives({ plan, elements, palette }) });
  const ctx = new OffscreenCanvas(SCENE_WIDTH, SCENE_HEIGHT).getContext("2d");
  const draw = (t) => ctx.putImageData(new ImageData(compositor.render(t), SCENE_WIDTH, SCENE_HEIGHT), 0, 0);
  for (let k = 0; k < 6; k++) draw(k * 1000 / 24);
  const start = performance.now();
  for (let k = 0; k < 24; k++) draw(10_000 + k * 1000 / 24);
  return (performance.now() - start) / 24;
}
`;
