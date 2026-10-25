import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import sharp from "sharp";
import { chromium, type Browser } from "playwright";
import { fixtureScene, readJson } from "./helpers.ts";
import { startTuner, stopTuners, tunerTree } from "./tuner.ts";

const id = "fixture-rainy-desk-a1b2";

let browser: Browser | undefined;
try {
  browser = await chromium.launch();
} catch {
  browser = undefined;
}

after(async () => {
  stopTuners();
  await browser?.close();
});

describe("Tuner smoke test", { skip: browser ? false : "no Playwright browser installed" }, () => {
  test("the Tuner page draws the fixture Scene lit, and a dragged Light moves in the plan on Save", async () => {
    const root = tunerTree();
    const url = await startTuner(root);
    const page = await browser!.newPage({ viewport: { width: 1400, height: 800 } });
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);

    const canvas = page.locator("canvas");
    await canvas.waitFor();
    assert.deepEqual(await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height]), [384, 240]);

    const frame = { x: 168, y: 28, w: 48, h: 3 };
    const poster = Array.from(await sharp(join(root, `scenes/${id}/poster.png`)).extract({ left: frame.x, top: frame.y, width: frame.w, height: frame.h }).raw().toBuffer());
    const element = await sharp(join(root, "library/elements/window-wood-transparent-panes-01.png")).extract({ left: 0, top: 0, width: frame.w, height: frame.h }).raw().toBuffer();
    const drawn = async () => canvas.evaluate((c: HTMLCanvasElement, r) => Array.from(c.getContext("2d")!.getImageData(r.x, r.y, r.w, r.h).data), frame);
    const deadline = Date.now() + 10_000;
    while (JSON.stringify(await drawn()) !== JSON.stringify(poster) && Date.now() < deadline) await page.waitForTimeout(100);
    const shown = await drawn();
    assert.deepEqual(shown, poster, "the window frame differs from the lit Poster");
    let unlit = 0;
    for (let i = 0; i < shown.length; i += 4) if (shown[i] === element[i] && shown[i + 1] === element[i + 1] && shown[i + 2] === element[i + 2]) unlit++;
    assert.equal(unlit, 0, `${unlit} window frame pixels show the Element's own colour`);

    const box = (await canvas.boundingBox())!;
    const scale = box.width / 384;
    const at = (x: number, y: number) => [box.x + (x + 0.5) * scale, box.y + (y + 0.5) * scale] as const;
    const lamp = { x: 168 + 124, y: 28 + 160 };
    await page.mouse.move(...at(lamp.x, lamp.y));
    await page.mouse.down();
    await page.mouse.move(...at(lamp.x - 10, lamp.y - 5), { steps: 4 });
    await page.mouse.move(...at(lamp.x - 20, lamp.y - 10), { steps: 4 });
    await page.mouse.up();

    const saved = page.waitForResponse((r) => r.url().endsWith("/save"), { timeout: 60_000 });
    await page.getByRole("button", { name: "Save" }).click();
    assert.equal((await saved).status(), 200);
    await page.getByRole("status").filter({ hasText: /Saved/ }).waitFor();
    const lampLight = readJson(root, fixtureScene).variants[0].lights.find((l: any) => l.id === "lamp");
    assert.deepEqual(lampLight.offset, { x: 104, y: 150 });
    assert.deepEqual(errors, []);
  });
});
