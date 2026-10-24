import { test } from "node:test";
import assert from "node:assert/strict";
import { createVariantSwitch } from "../viewer/variant.ts";

const variant = (id: string, title: string) => ({ id, title, ambient: { level: 0 }, lights: [], emissiveOff: [] });
const plan = (...variants: ReturnType<typeof variant>[]) => ({ variants }) as any;
const twoVariants = plan(variant("night-rain", "Rainy night"), variant("clear-night", "Clear night"));
const scene = "https://example.test/pixel-art/scenes/fixture-rainy-desk-a1b2/";

function fakeHistory() {
  const pushed: string[] = [];
  return { pushed, pushState: (_state: unknown, _unused: string, url: URL) => void pushed.push(url.href) };
}

test("with no variant in the URL the default Variant plays", () => {
  const s = createVariantSwitch({ plan: twoVariants, url: new URL(scene), history: fakeHistory() });
  assert.equal(s.current.id, "night-rain");
  assert.equal(s.shareUrl().href, scene);
});

test("?variant= picks that Variant", () => {
  const s = createVariantSwitch({ plan: twoVariants, url: new URL(`${scene}?variant=clear-night`), history: fakeHistory() });
  assert.equal(s.current.title, "Clear night");
  assert.equal(s.shareUrl().href, `${scene}?variant=clear-night`);
});

test("an unknown variant id falls back to the default", () => {
  const s = createVariantSwitch({ plan: twoVariants, url: new URL(`${scene}?variant=snowy-dawn`), history: fakeHistory() });
  assert.equal(s.current.id, "night-rain");
});

test("switching cycles the Variants and pushes the URL without a navigation", () => {
  const history = fakeHistory();
  const seen: string[] = [];
  const s = createVariantSwitch({ plan: twoVariants, url: new URL(scene), history, onChange: (v) => seen.push(v.id) });
  assert.equal(s.next().id, "clear-night");
  assert.equal(s.current.id, "clear-night");
  assert.equal(s.next().id, "night-rain");
  assert.deepEqual(history.pushed, [`${scene}?variant=clear-night`, scene]);
  assert.deepEqual(seen, ["clear-night", "night-rain"]);
});

test("switching keeps any other query parameter", () => {
  const history = fakeHistory();
  const s = createVariantSwitch({ plan: twoVariants, url: new URL(`${scene}?ref=mail`), history });
  s.next();
  assert.deepEqual(history.pushed, [`${scene}?ref=mail&variant=clear-night`]);
});

test("the control shows on a two-Variant plan and is hidden on a one-Variant plan", () => {
  assert.equal(createVariantSwitch({ plan: twoVariants, url: new URL(scene), history: fakeHistory() }).visible, true);
  const single = createVariantSwitch({ plan: plan(variant("night", "Night")), url: new URL(scene), history: fakeHistory() });
  assert.equal(single.visible, false);
});
