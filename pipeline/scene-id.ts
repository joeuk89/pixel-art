import { randomBytes, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { main } from "./lib/cli.ts";

const MAX_WORDS = 6;
const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, MAX_WORDS)
    .join("-");
}

function suffix(): string {
  return [...randomBytes(4)].map((b) => SUFFIX_ALPHABET[b % SUFFIX_ALPHABET.length]).join("");
}

main(() => {
  const base = slug(process.argv.slice(2).join(" "));
  if (!base) throw new Error("usage: scene-id <words...>");
  let id: string;
  do id = `${base}-${suffix()}`;
  while (existsSync(join(process.cwd(), "scenes", id)));
  return { id, seed: randomInt(0, 2 ** 31), createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
});
