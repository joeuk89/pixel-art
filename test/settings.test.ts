import { test } from "node:test";
import assert from "node:assert/strict";
import { storedLevel, storeLevel } from "../viewer/settings.ts";

function memoryStore(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    entries: () => Object.fromEntries(map),
  };
}

test("Music and Ambient both default to 1", () => {
  const store = memoryStore();
  assert.equal(storedLevel("music", store), 1);
  assert.equal(storedLevel("ambient", store), 1);
});

test("each level persists under its own key", () => {
  const store = memoryStore();
  storeLevel("music", 0.25, store);
  storeLevel("ambient", 0.6, store);
  assert.deepEqual(store.entries(), { "pixel-art:music": "0.25", "pixel-art:ambient": "0.6" });
  assert.equal(storedLevel("music", store), 0.25);
  assert.equal(storedLevel("ambient", store), 0.6);
});

test("a stored level of 0 is kept, not reset to the default", () => {
  const store = memoryStore({ "pixel-art:ambient": "0" });
  assert.equal(storedLevel("ambient", store), 0);
});

test("an old pixel-art:volume value has no effect", () => {
  const store = memoryStore({ "pixel-art:volume": "0.3" });
  assert.equal(storedLevel("music", store), 1);
  assert.equal(storedLevel("ambient", store), 1);
});

test("a value outside 0 to 1 or not a number falls back to 1", () => {
  for (const bad of ["1.5", "-0.1", "loud", ""]) {
    assert.equal(storedLevel("music", memoryStore({ "pixel-art:music": bad })), 1, bad);
  }
});

test("a store that throws reads as the default and swallows writes", () => {
  const broken = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  };
  assert.equal(storedLevel("music", broken), 1);
  assert.doesNotThrow(() => storeLevel("music", 0.5, broken));
});
