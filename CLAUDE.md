# Pixel Art Scenes

A static site of animated pixel-art Scenes with Soundtracks, published to GitHub Pages from `main`. The Director skill (`.claude/skills/director/`) turns a Prompt into a Scene by running the scripts in `pipeline/`; the Viewer (`viewer/`) plays it. `README.md` covers setup and commands.

## Language

Use the terms in `GLOSSARY.md` in code, tests, issues and commit messages: Scene, Element, Placement, Layer, Primitive, Attempt, Quality gate and the rest. Each entry lists the synonyms to avoid.

## Decisions

Read `docs/adr/` before changing Palettes, Share links or Element sizing. In short:

- Palettes in `library/palettes/` are immutable once an Element is locked to one. Add a new Palette instead of editing.
- Elements are generated at display size. The Viewer never scales a Placement.
- Each Scene has its own `scenes/<id>/index.html` stub; the Viewer stays one document and swaps Scenes with `history.pushState`, so sound permission survives.
- The Scene canvas stays 192x120. Higher resolutions were tried and rejected.

## Working in the code

- Node 22.18+ runs `.ts` files directly through type stripping: run scripts as `node pipeline/<name>.ts`. Use only erasable TypeScript syntax (no `enum`, no parameter properties, no `namespace`), and import with the `.ts` extension.
- `schema/index.ts` is the single source of truth for the Scene plan, Element records and sound records. `pipeline/validate.ts` enforces it, and the Viewer draws what it describes.
- Scripts that call a paid service read keys with `node --env-file=.env`. Those runs spend the owner's money: run them only inside a Director run or when the owner asks.
- Tests run on `node --test` and point every service base URL at the fixture server in `test/fixture-server.ts`, with fakes in `test/fixtures/services/`. Add a fake there rather than calling a real service. `test/smoke.test.ts` needs Playwright's Chromium.
- Run one test file with `node --test test/<name>.test.ts`.
- `viewer.js`, `dist/`, `scratch/` and `.agent/` are gitignored. `scratch/` is the place for throwaway files such as 8x upscales.
- `prototypes/` holds throwaway experiments with their own `package.json`. They are not part of the build or the tests.

## Scenes and the library

- A Scene's `status` is `draft` until `pipeline/preview.ts` marks it `resolved`. Only resolved Scenes are published.
- Library Elements stay even when no Scene uses them; `pipeline/orphans.ts` lists them. Delete library files only when the owner asks.
- The owner commits and pushes Scenes. A Director run ends with staged files and a preview, never a commit.

## Before you finish

Run `npm test` and `node pipeline/validate.ts`; CI runs both on every push to `main` and fails the deploy if either fails.

## Agent skills

### Issue tracker

Issues are tracked as GitHub Issues on `joeuk89/pixel-art`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
