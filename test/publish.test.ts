import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repo } from "./helpers.ts";

const read = (path: string) => readFileSync(join(repo, path), "utf8");

test("NOTICE.md names every service in use and states the AI notice once", () => {
  const notice = read("NOTICE.md");
  for (const service of ["PixelLab", "Retro Diffusion", "Stable Audio", "Stability AI", "ElevenLabs", "fal.ai", "Lyria", "Freesound"]) {
    assert.match(notice, new RegExp(service.replace(".", "\\.")), service);
  }
  const sources = new Set(
    readdirSync(join(repo, "library/ambient"))
      .filter((n) => n.endsWith(".json"))
      .map((n) => JSON.parse(read(`library/ambient/${n}`)).source as string),
  );
  for (const source of sources) assert.match(notice.toLowerCase(), new RegExp(source), source);
  assert.equal(notice.match(/generated with AI/g)?.length, 1);
});

test("the Pages workflow runs on push to main and tests, validates, bundles and assembles before uploading", () => {
  const workflow = read(".github/workflows/pages.yml");
  assert.match(workflow, /on:\s*\n\s+push:\s*\n\s+branches:\s*\[\s*main\s*\]/);
  const steps = ["npm ci", "npm test", "node pipeline/validate.ts", "npm run bundle", "npm run assemble", "actions/upload-pages-artifact"];
  const at = steps.map((step) => workflow.indexOf(step));
  for (const [i, step] of steps.entries()) assert.ok(at[i] >= 0, `${step} is missing`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, "steps run out of order");
  assert.match(workflow, /path:\s*dist\b/);
});

test("the Pages deploy job runs only after the build job succeeds and never cancels a deploy in flight", () => {
  const workflow = read(".github/workflows/pages.yml");
  const deploy = workflow.slice(workflow.indexOf("\n  deploy:"));
  assert.ok(deploy.length > 1, "no deploy job");
  assert.match(deploy, /needs:\s*build/);
  assert.doesNotMatch(deploy, /if:\s*always\(\)/);
  assert.match(deploy, /actions\/deploy-pages@/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.match(workflow, /pages:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
  assert.doesNotMatch(workflow, /enablement:/);
});
