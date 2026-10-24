# Pixel Art Scenes

Cosy, animated pixel-art scenes with matching music and ambient sound, made to be left open in a browser tab.

**Watch them at <https://joeuk89.github.io/pixel-art/>.**

Each Scene is a small pixel-art picture (384x240) that the browser draws live: rain runs down the glass, lamps glow, steam rises, and a looping Soundtrack of music and ambient sound plays under it. AI services generate the artwork and sound; a Claude Code skill called the Director plans each Scene and drives the generation.

## Watching a Scene

Open the site and pick a Scene from the Gallery. Sound starts muted; click anywhere in the Scene to turn it on.

| Key | Action |
| --- | --- |
| `M` | Mute or unmute |
| `F` | Fullscreen |
| `I` | Show or hide the info panel (description and sound credits) |
| `Esc` | Back to the Gallery |

Every Scene has its own Share link, `https://joeuk89.github.io/pixel-art/scenes/<id>/`, which previews with its title and Poster in chat apps.

## Making a Scene

You need Claude Code and API keys for the generation services.

1. Set up the project (see [Setup](#setup)) and fill in `.env`.
2. In Claude Code, from the repo root, run `/director <your Prompt>`, for example `/director a rainy attic study at midnight with a sleeping cat`.
3. The Director writes a Scene plan and stops once at the **Plan gate**: it shows the Elements it will reuse or generate, the Soundtrack, and the estimated cost. Edit the plan or say yes.
4. After your yes it generates everything without asking again, checks the result, and stages the files.
5. Open the preview URL it prints. If you like the Scene, commit and push. If not, tell the Director what to change; it redoes only that.

The Director never commits or pushes. Pushing to `main` publishes the site.

### Costs

Generation costs real money. The Director estimates each Scene at the Plan gate and holds to a per-Scene budget, plus monthly ceilings of 2,000 PixelLab generations and £50 of metered spend. Run `node pipeline/ledger.ts` to see this month's spend so far.

Reused Elements and curated Freesound sounds cost nothing, so Scenes get cheaper as the Element library grows.

## Setup

Requirements: Node 22.18 or later in the 22.x line (see `.nvmrc`). Node runs the TypeScript files directly; there is no compile step.

```sh
nvm use
npm install
npx playwright install chromium   # the smoke test drives a real browser
cp .env.example .env               # then add your keys
```

| Key | Service | Used for |
| --- | --- | --- |
| `PIXELLAB_API_KEY` | PixelLab | Element images and Frame strips |
| `RETRO_DIFFUSION_API_KEY` | Retro Diffusion | Subtle-motion Frame strips |
| `STABILITY_API_KEY` | Stable Audio | Music loops |
| `GEMINI_API_KEY` | Google Lyria | Reserve music service |
| `FAL_KEY` | fal.ai (ElevenLabs Sound Effects) | Generated ambient sounds |
| `FREESOUND_API_KEY` | Freesound | Curating ambient sounds |

You only need the keys for the services a Scene uses. To check the audio keys, run `node --env-file=.env pipeline/check-audio-keys.ts`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Serves the site at <http://localhost:8000> and rebuilds the Viewer on change |
| `npm test` | Runs the test suite; tests use a local fixture server and never call real services |
| `node pipeline/validate.ts` | Checks every Scene plan, Element record and sound record |
| `npm run bundle && npm run assemble` | Builds the publishable site into `dist/` |
| `node pipeline/library-search.ts <words>` | Searches the Element library (`--sounds` for the Sound library) |
| `node pipeline/draw-element.ts <scene.json> <placementId>` | Draws a local-Finish Element or Seamless texture with the local pixel engine, free, and gates it |
| `node pipeline/orphans.ts` | Lists library Elements and sounds no Scene uses |
| `node pipeline/ledger.ts` | Shows this month's generation spend |

## Publishing

GitHub Actions publishes to GitHub Pages on every push to `main` (`.github/workflows/pages.yml`). The build runs the tests and `validate`, bundles the Viewer and assembles `dist/`. Only Scenes with `status: "resolved"` are published.

## Repository layout

| Path | Contents |
| --- | --- |
| `scenes/<id>/` | One Scene: `scene.json` (the Scene plan), its sound files, Posters and Share link page |
| `library/elements/` | The Element library: each Element's PNG, Frame strip and record |
| `library/ambient/` | The Sound library: Ambient loops and One-shots with their licence records |
| `library/palettes/` | The house Palettes |
| `viewer/` | The Viewer, bundled into `viewer.js` |
| `pipeline/` | Scripts the Director runs to generate, check and stage a Scene |
| `schema/` | The Scene plan and record schemas |
| `.claude/skills/director/` | The Director skill |
| `docs/adr/` | Design decisions |
| `GLOSSARY.md` | What each project term means |

## Credits

Artwork, music and sound are AI-generated or curated from Freesound. [NOTICE.md](NOTICE.md) lists the services, and each Scene's info panel credits its sounds with author and licence.
