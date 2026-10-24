import { budget } from "./lib/budget.ts";
import { main } from "./lib/cli.ts";
import { readScene } from "./lib/library.ts";

main(() => {
  const [file, ...rest] = process.argv.slice(2);
  if (!file || rest.length > 0) throw new Error("usage: budget <scene.json>");
  return budget(readScene(file));
});
