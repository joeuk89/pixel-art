# Ambient sound sources and generated sound effects

Research for [issue #5](https://github.com/joeuk89/pixel-art/issues/5). Facts checked on 2026-10-23 against the sources linked in each section. Prices and terms change; re-check before relying on a number.

## Question

Where should ambient sound for a Scene's Soundtrack come from: rain on glass, wind, fire crackle, distant traffic, a ticking clock, snowfall hush? Which libraries offer CC0 or equally permissive seamless loops that can play on public Share links from GitHub Pages, and which pay-as-you-go API should generate the effects the library lacks?

## Recommendation

**Curate CC0 loops from Freesound for every staple, and fill gaps with ElevenLabs Sound Effects (loop mode) billed pay-as-you-go through fal.ai.**

- **Library policy: CC0 only.** Every other free library (Pixabay, Sonniss, Zapsplat, BBC, Mixkit) forbids redistributing the sound "as a sound effect" or on a "standalone" basis. A static GitHub Pages site serves every loop as a directly fetchable file, so that clause is a live risk. CC0 has no such clause: Freesound's own licence text says "You can copy, modify, distribute and perform the sound, even for commercial purposes, all without the need of asking permission to the author." No attribution is required, so the Viewer needs no credits panel, though a provenance manifest in the repo is still worth keeping.
- **Freesound covers all six staples with CC0 loops today** (rain on glass, outdoor rain, wind, fire crackle, traffic, ticking clock, snow hush) plus the obvious extras (forest birds, crickets, waves, stream, room tone). The only thin spot is cafe chatter: one CC0 recording, 5 minutes long and not a loop.
- **Gap filler: ElevenLabs Sound Effects v2 via fal.ai.** $0.002 per second of output, no plan, no minimum, a `loop: true` parameter that asks the model for a seamless loop, and a "Commercial use" tag on the model page. A 20-second loop costs $0.04. Direct ElevenLabs is the fallback when you need the full 30 s or 48 kHz WAV: it is also pay-as-you-go ($5 minimum top-up, credits expire after 12 months) but the Free tier's "non-commercial" terms sit under it.
- **Stable Audio 2.5 ($0.08 per generation, up to 190 s) is the budget option for long beds** but has no loop mode, so the pipeline would have to crossfade the ends itself. Keep it in reserve until a prototype shows whether that works.

Budget check: at $0.04 to $0.06 per generated loop and two or three generated effects per Scene at most, generated ambient sound costs well under 20p per Scene against the £2 ceiling.

## Part 1: curated loop libraries

### Why the licence clause matters here

Loops are committed to a private repo and served by GitHub Pages. Pages is a static host: anyone with a Share link can read the audio URL from the page and download the file. That is "distribution" of the file in substantially its original form, whatever the Scene around it looks like. The libraries below split into two groups on exactly this point.

| Library | Licence | Attribution | Redistribution clause | Verdict |
| --- | --- | --- | --- | --- |
| [Freesound](https://freesound.org/help/faq/) (filtered to CC0) | CC0 1.0 per sound | None ("you can't claim you are the author") | None | **Use** |
| [OpenGameArt](https://opengameart.org/) (filtered to CC0) | CC0 per asset (also hosts CC-BY, OGA-BY) | None | None | Use; small ambient catalogue |
| [Kenney](https://kenney.nl/support) | CC0, "all game assets on the asset pages are public domain licensed (CC0)" | Not required | None | Fine but no ambient packs; UI, RPG, sci-fi, impacts only |
| [Pixabay](https://pixabay.com/service/terms/) | Pixabay Content License (non-CC0 content) | Not required | "You cannot sell or distribute Content ... on a Standalone basis", where Standalone means "no creative effort has been applied to the Content and it remains in substantially the same form"; "Bulk, large-scale or systematic copying of Content is strictly prohibited" | Avoid for hosted files |
| [Sonniss GDC bundles](https://sonniss.com/gdc-bundle-license/) | Sonniss licence v2.0 (27 Aug 2026) | Not required | May not "distribute, publish, sub-license or otherwise supply the sound effects as sound effects to any other person"; "Re-designed and manipulated sounds remain licensed material" | Avoid for hosted files; about 207 GB of WAV, mostly not loops |
| [Zapsplat](https://www.zapsplat.com/copyright-and-audio-licensing-for-beginners) | Zapsplat Standard | Required on free accounts ("Sound from Zapsplat.com") | No redistribution "as standalone files" on any plan | Avoid |
| [BBC Sound Effects](https://sound-effects.bbcrewind.co.uk/licensing) | RemArc licence | Expected | Site text: "use them in your own personal/educational projects, or licence them for use"; commercial use is a separate purchase. The licence page needs JavaScript and could not be fetched; press coverage says personal, educational or research use only | Avoid: public Share links stretch "personal project" |
| Mixkit | "Sound Effects Free License" | Unknown | Licence text not reachable without JavaScript | Not verified; skip |

Freesound is the only source that combines a large catalogue, a licence filter, an API, and a licence with no redistribution clause.

### Freesound in detail

Source: [FAQ](https://freesound.org/help/faq/), [API overview](https://freesound.org/docs/api/overview.html), [API resources](https://freesound.org/docs/api/resources_apiv2.html), [API terms](https://freesound.org/help/tos_api/).

**Licences on the site.** Three current licences: CC0 ("you can do pretty much what you want with the sound", including selling it, but "you can't claim you are the author!"), CC BY (credit required), CC BY-NC (credit required, "you can't earn any money with the piece of work you create!"). Legacy Sampling+ sounds still exist from Freesound 1 and should be treated as non-commercial. Each sound page shows its licence above the download button.

**Filtering.** The site search accepts the licence filter in the URL: `https://freesound.org/search/?q=rain+loop&f=license:"Creative Commons 0"&s=num_downloads+desc`. The API uses the same syntax: `filter=license:"Creative Commons 0"`, combinable with `filter=tag:loop` and `filter=duration:[5 TO 60]`. The three licence filter values are exactly `"Creative Commons 0"`, `"Attribution"` and `"Attribution NonCommercial"`.

**API access.** Free API key from `https://freesound.org/apiv2/apply`, passed as `?token=`. Rate limit 60 requests a minute and 2,000 a day; downloads, uploads and writes are limited to 30 a minute and 500 a day. Searching and fetching previews need only the token. **Downloading the original file needs OAuth2.** The API terms say Freesound "may charge for this service in the future" and that commercial API use is negotiated separately with UPF; a personal Director skill pulling a dozen files a month is well inside normal use. The terms also forbid making "full copies of the database".

**Formats.** Downloads are "the exact same original file that was uploaded": WAV, FLAC, AIFF, OGG or MP3, at whatever sample rate the uploader used (44.1, 48 and 96 kHz all appear in the starter list). Previews are generated MP3 and OGG at lower bitrates (`preview-hq-mp3`, `preview-hq-ogg`, `preview-lq-*`) and are fine for auditioning but not for shipping.

**Coverage of the staples (CC0, sorted by downloads, checked 2026-10-23).** Every staple returned multiple CC0 hits tagged or described as loops in the first eight results:

| Staple | CC0 loop candidates in top 8 | Notes |
| --- | --- | --- |
| Rain on glass | 3 | "Rain from Indoors - Perfect loop", "Rain on the windows", "freezing rain ice on window, loop" |
| Outdoor rain | 5 | Several 20 s to 75 s seamless loops |
| Wind | 4 | Mix of 5 s texture loops and 70 s field loops |
| Fire crackle | 6 | 5 s to 2 min; several "seamless" |
| Distant traffic | 3 | "Seamless City Loop" (30 s, built from a CC0 source) plus two long beds |
| Ticking clock | 4 | Many short 4 s loops; the staple with the most choice |
| Snowfall hush | 2 long beds | 8 to 14 minute recordings, not loops; a 5 s "Subzero Frost Loop" for texture |
| Forest birds | 5 | 27 s to 30 s seamless loops |
| Crickets | 4 | 10 s to 30 s loops |
| Waves | 4 | 22 s to 60 s loops |
| Stream | 6 | 5 s to 34 s loops |
| Room tone / vent hum | 4 | "House Vent Loop 01-03" |
| Cafe chatter | 0 loops | One 5-minute CC0 remaster of a CC-BY original; not a loop |

So the gap list for generation is short: cafe or crowd murmur, a true snowfall-hush loop (the long beds need trimming), and whatever a Prompt asks for that is not on this list.

### OpenGameArt

A CC0 search for "ambient loop" in sound effects returned 11 results, including [Rain on Window Loop](https://opengameart.org/content/rain-on-window-loop) (alxl, WAV, 1.9 MB, "just shy of 11 seconds", "Available under CC0; attribution is appreciated but not necessary") and [30 CC0 SFX loops](https://opengameart.org/content/30-cc0-sfx-loops) (rubberduck, OGG, mostly machines, 1 rain, 3 ambient). Useful as a second CC0 source but far thinner than Freesound for nature ambience.

## Part 2: generated sound effects

### Comparison

| Service | Price (2026-10-23) | Max length | Loop mode | Output | Terms for public use |
| --- | --- | --- | --- | --- | --- |
| [ElevenLabs Sound Effects via fal.ai](https://fal.ai/models/fal-ai/elevenlabs/sound-effects/v2) | $0.002 per second, pay-as-you-go | 22 s (`duration_seconds` 0.5 to 22) | `loop: true`, "Whether to create a sound effect that loops smoothly" | MP3 up to 192 kbps, PCM to 48 kHz, Opus | fal tags the model "Commercial use"; fal ToS: output "may not be unique across users", use "at Customer's sole risk" |
| [ElevenLabs Sound Effects direct](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert) | $0.12 per minute of audio on the API pricing page; docs say 40 credits per second when duration is set; PAYG top-up minimum $5, credits expire after 12 months | 30 s (`duration_seconds` 0.5 to 30) | `loop: true` | MP3; WAV/PCM 44.1 kHz needs Pro tier; "WAV 48 kHz only for non-looping effects" | Free tier is "non-commercial purposes" / "Personal use only"; paid tiers "Commercial"; you "retain all rights in and to your Output" |
| [Stability AI Stable Audio 2.5](https://docs.stability.ai/api-reference/stable-audio-2/text-to-audio.md) | 8 credits = $0.08 per generation, any length; 25 free credits; credits expire one year after purchase | 190 s | None | MP3 or WAV, 44.1 kHz stereo | Stability ToS: "you own the Output"; FAQ: commercial use "Yes, as long as the output doesn't violate anyone's copyright" |
| [Stability AI Stable Audio 3.0](https://docs.stability.ai/api-reference/stable-audio/text-to-audio.md) | 8 credits = $0.08 per generation; async (poll `/v2beta/audio/results/{id}`) | 380 s | None | MP3 or WAV | As above |
| [Stable Audio 3 Small SFX on fal.ai](https://fal.ai/models/fal-ai/stable-audio-3/small/sfx/base/text-to-audio) | $0.0283 per clip | 120 s | None | mp3, wav, flac, ogg, opus, m4a, aac | fal ToS as above; base checkpoint "intended for fine-tuning" |
| [Mirelo SFX 2.0 on fal.ai](https://fal.ai/models/mirelo-ai/sfx2.0/text-to-audio) | $0.010 per second until 2026-12-13, then $0.015 | not checked | None listed | not checked | Not evaluated further; five times the ElevenLabs rate |
| Stable Audio Open 1.0 (self-hosted) | GPU time only | 47 s | None | 44.1 kHz stereo | [Community License](https://stability.ai/community-license-agreement): free below a revenue threshold, "Powered by Stability AI" notice if you distribute the model; model card says "should not be used on downstream applications without further risk evaluation" |

### ElevenLabs

Sources: [API reference](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert), [capabilities doc](https://elevenlabs.io/docs/overview/capabilities/sound-effects), [product page](https://elevenlabs.io/sound-effects), [API pricing](https://elevenlabs.io/pricing/api), [Pay As You Go](https://elevenlabs.io/docs/overview/administration/pay-as-you-go), [Terms of Use](https://elevenlabs.io/terms-of-use).

- Endpoint `POST /v1/sound-generation` with `text`, `duration_seconds` (0.5 to 30, or omitted to let the model pick), `loop` (default false), `prompt_influence` (0 to 1, default 0.3), `model_id` (`eleven_text_to_sound_v2` default, `eleven_text_to_sound_v3` also listed), and `output_format` as a query parameter.
- It is the only service in this list with a first-party loop mode. The docs describe loop output as "Designed for seamless repeat playback, no audible start or end point" and suggest exactly this use: generate about 30 s of "soft rain" and loop it.
- Pricing is stated three ways and they do not reconcile cleanly: the API pricing page lists Sound Effects at **$0.12 per minute** and separately says "Music and Sound Effects are billed per generation"; the capabilities doc says **40 credits per second** when a duration is set; two copies of the help-centre article give 11 and 20 credits per second for API users. Treat $0.12 per minute ($0.06 for a 30 s loop) as the planning figure and check the first invoice.
- Pay As You Go is a prepaid balance, "available to all self-serve tiers, including free". Minimum top-up $5, non-refundable, expires 12 months after purchase. No monthly subscription is needed. But a Free-tier account keeps Free-tier limits and terms: the product page lists Free as "Personal use only", and the Terms of Use say free users "may only use the Services for non-commercial purposes". A non-monetised personal Gallery with public Share links is plausibly non-commercial, but the wording is not written for that case. The $6 Starter plan clears it but breaks the no-monthly-minimum constraint.
- Format gates: MP3 192 kbps needs Creator or above; PCM/WAV at 44.1 kHz needs Pro or above. On Free or PAYG you get MP3 up to 128 kbps and PCM at 48 kHz or lower, which is enough for the Viewer.

### ElevenLabs through fal.ai

Sources: [model page](https://fal.ai/models/fal-ai/elevenlabs/sound-effects/v2), [llms.txt](https://fal.ai/models/fal-ai/elevenlabs/sound-effects/v2/llms.txt), [fal pricing](https://fal.ai/pricing), [fal terms](https://fal.ai/terms).

- Same model and the same `loop` and `prompt_influence` parameters, but `duration_seconds` tops out at **22 s**, not 30.
- $0.002 per second, billed by fal on a prepaid balance; "you only pay for the computing power you consume". No ElevenLabs account or plan is involved, so the Free-tier wording above does not apply. The model page carries a "Commercial use" tag.
- fal's terms do not say the customer owns output; they treat "Output Content generated for Customer" as the customer's confidential information, state that output "may not be unique across users", and that use of output is at the customer's risk. This is weaker than ElevenLabs' "you retain all rights in and to your Output" but carries no non-commercial restriction.

### Stability AI

Sources: [pricing](https://docs.stability.ai/pricing), [Stable Audio 2 / 2.5 text-to-audio](https://docs.stability.ai/api-reference/stable-audio-2/text-to-audio.md), [Stable Audio 3 text-to-audio](https://docs.stability.ai/api-reference/stable-audio/text-to-audio.md), [FAQ](https://docs.stability.ai/faq.md), [Terms of Service](https://stability.ai/2025-terms-of-service).

- Credits at $0.01 each, 25 free on signup, bought in advance with no subscription; third-party pages report a $10 / 1,000-credit top-up but Stability's pages do not state a minimum. Unused credits "expire one year after the date of purchase".
- Stable Audio 2.5 and 3.0 cost a flat 8 credits ($0.08) per successful generation regardless of length (2.5 up to 190 s, 3.0 up to 380 s). Stable Audio 2.0 is 20 credits. Failed generations are not charged. Output is MP3 or WAV, 44.1 kHz stereo.
- No loop parameter on any Stability endpoint. Seamless looping would need the pipeline to crossfade the tail into the head, or to use the audio-to-audio or inpaint endpoints to regenerate the join. Untested.
- Ownership is the clearest of the three: "as between Stability and you, you own the Output" and Stability assigns "all of our right, title, and interest (if any) in the Outputs" to you. The FAQ answers commercial use with "Yes, as long as the output doesn't violate anyone's copyright." The API can return a 422 `copyrighted_content` error if it detects copyrighted material in audio.
- Both models were "exclusively trained on licensed data from the AudioSparx music library", and 2.5 and 3.0 were also pre-trained on licensed Freesound data. The models are tuned for music; the docs' prompt guidance is about instruments, moods and genres, so sound-effect quality is the thing to prototype.

## Starter list: ten loops to curate first

All CC0 1.0 on Freesound, verified on each sound page on 2026-10-23. Downloads and ratings are as shown that day. "Seamless" means the uploader says so; the Viewer prototype should confirm by ear.

| # | Staple | Sound | Author | Length | Original format | Why this one |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Rain on glass | [Rain from Indoors - Perfect loop](https://freesound.org/people/samesamesame/sounds/242889/) | samesamesame | 48 s | WAV 44.1 kHz 24-bit stereo | "A perfect loop of rain, EQ'd to sound like it was recorded from indoors"; 1.6K downloads, 35 ratings |
| 2 | Rain, outdoor, with birds and a passing car | [SuburbRain_OutdoorLoop.wav](https://freesound.org/people/PhilllChabbb/sounds/238431/) | PhilllChabbb | 50 s | WAV 44.1 kHz 24-bit stereo | Recorded at a window, "more outdoor feel"; good for a porch or garden Scene |
| 3 | Soft rain, small file | [Soft Rain Loop](https://freesound.org/people/_lynks/sounds/595717/) | _lynks | 22.5 s | OGG Vorbis 44.1 kHz, 419 KB | "Distracting drips removed and seamlessly looped"; already a web-friendly format |
| 4 | Wind | [Wind through trees (loop)](https://freesound.org/people/NomadApe/sounds/444921/) | NomadApe | 70 s | M4A 44.1 kHz stereo | "Sound trimmed in a way that makes it good for looping"; transcode from AAC |
| 5 | Fire crackle | [Crackling Flames (loop)](https://freesound.org/people/NickTayloe/sounds/813328/) | NickTayloe | 35 s | WAV 48 kHz 24-bit stereo | Close-miked wooden-wick candles, "Loops seamlessly", suggested as a clean fireplace with light processing |
| 6 | Fire crackle, short texture | [fire crackling loop.wav](https://freesound.org/people/soundofsong/sounds/650574/) | soundofsong | 5 s | WAV 44.1 kHz 16-bit stereo | 979 downloads; tiny, layers under #5 for extra pops |
| 7 | Distant traffic, night | [Seamless City Loop](https://freesound.org/people/qubodup/sounds/223093/) | qubodup | 30 s | FLAC 48 kHz 16-bit stereo | "Looping night city ambience", remixed from a CC0 window recording; the description mentions CC BY attribution on the author's profile but the sound itself is licensed CC0 |
| 8 | Ticking clock | [Loopable Ticking Clock](https://freesound.org/people/OwlStorm/sounds/212181/) | OwlStorm (Ashe Kirk) | 4 s | WAV 44.1 kHz 16-bit stereo | 4.4K downloads; "All my sounds are now CC0, so you don't have to credit me" |
| 9 | Snowfall hush, winter texture | [Subzero Frost Loop](https://freesound.org/people/qubodup/sounds/844261/) | qubodup | 4.9 s | WAV 96 kHz 24-bit mono | Tagged seamless, snow, wind, crackle; layer with a filtered wind bed or a trimmed slice of [Snow Silence](https://freesound.org/people/shouya_trumpet/sounds/842985/) (14 min, 153 MB, CC0) |
| 10 | Forest birds | [Forest birds - ambient seamless loop](https://freesound.org/people/Magnesus/sounds/723913/) | Magnesus | 27 s | WAV 48 kHz 16-bit stereo | "I made it into a seamless loop ... I set the license to CC0" |

Reserve bench, also CC0 and checked the same day: [Gentle Ocean Waves Loop](https://freesound.org/people/kkenny101/sounds/852826/) (21.8 s, 48 kHz mono), [Water Stream (Looped)](https://freesound.org/people/tymorafarr/sounds/249666/) (33.6 s FLAC), [Night_crickets_Loopable.wav](https://freesound.org/people/2887679652/sounds/167304/) (30 s, 96 kHz), [House Vent Loop 01](https://freesound.org/people/HECKFRICKER/sounds/753540/) (43 s, cosy indoor room tone), [Slowly Raining Loop](https://freesound.org/people/unfa/sounds/177479/) (73 s FLAC, 1.9K downloads), [Rain on Window Loop](https://opengameart.org/content/rain-on-window-loop) on OpenGameArt (11 s WAV).

Snowfall hush and cafe murmur are the two staples where the library is weakest; they are the first candidates for a generated loop.

## Licensing red flags

1. **Redistribution clauses in "free" libraries.** Pixabay, Sonniss, Zapsplat and BBC all forbid supplying the sound as a standalone file. GitHub Pages serves every loop as a standalone, world-readable URL. Do not mix these into the library, even for a private repo: the Pages output is public.
2. **Freesound is per-sound, not per-site.** Filter on `license:"Creative Commons 0"` every time and record the licence from the sound page itself in a manifest. The site also hosts CC BY, CC BY-NC and legacy Sampling+ sounds, and uploaders can relicense. Remixes of CC-BY material labelled CC0 (as with the Seamless City Loop's description) are the uploader's responsibility, but prefer sounds whose provenance is plain.
3. **ElevenLabs Free tier wording.** "Personal use only" and "non-commercial purposes" cover a hobby Gallery in spirit, but public Share links are not what that clause was drafted for. Going through fal.ai sidesteps the plan tiers; going direct and wanting certainty means the $6 Starter plan, which the standing constraints rule out.
4. **No service guarantees unique output.** ElevenLabs ("Two different parties may receive the same or similar Output"), Stability ("multiple users might get similar results") and fal ("Output Content may not be unique across users") all say so. Generated ambience cannot be claimed as exclusive; irrelevant for a personal Gallery, worth knowing if the Element library is ever shared.
5. **Generative-AI preferences on Freesound.** Some uploaders add "I DO NOT GIVE CONSENT to using my sounds in training generative AI" (unfa's Slowly Raining Loop is one). CC0 makes this legally moot but respect it: never feed library loops into a generation service as audio-to-audio input.
6. **Keep provenance even though CC0 needs none.** A `manifest.json` entry per loop with Freesound ID, URL, author, licence name and the date fetched is cheap and answers any later question about a file in the repo.

## What a prototype should test

- **Seamless playback in the Viewer.** `HTMLAudioElement.loop` leaves a gap in some browsers; Web Audio `AudioBufferSourceNode.loop` with decoded buffers does not. MP3 encoders add priming and padding frames that break a seamless loop, so transcode to OGG Vorbis or Opus (or trim the padding) and listen to the join on at least Chrome and Safari.
- **Transcode and size.** The starter list ranges from 419 KB OGG to 12.7 MB WAV, with a 153 MB bed on the bench. Pick one house format (Opus or Vorbis, about 96 to 128 kbps) and confirm a Scene's full Soundtrack stays small enough for the 100 MB per-file and 1 GB repo limits with room for hundreds of Scenes.
- **ElevenLabs loop quality.** Generate cafe murmur and snowfall hush at 20 s with `loop: true` via fal.ai, loop them in the Viewer, and judge the join and the texture. Try `prompt_influence` at 0.3 and 0.6.
- **22 s vs 30 s.** Check whether the fal.ai 22 s cap matters for ambience; if a 30 s loop audibly repeats less, test the direct ElevenLabs endpoint on a $5 PAYG top-up.
- **Stable Audio 2.5 as a long-bed source.** Generate a 60 s rain bed for $0.08, crossfade the last 2 s into the first 2 s in the pipeline, and compare with the ElevenLabs native loop. If it holds up, it is the cheapest route for anything longer than 30 s.
- **Billing reconciliation.** Run ten ElevenLabs generations and compare the invoice with the $0.12 per minute figure, since the credit-per-second numbers in ElevenLabs' own docs disagree.
- **Freesound API flow for the Director.** Confirm search with the licence filter and preview download work with just the token, and decide whether the Director downloads originals (OAuth2 needed) or whether the owner fetches originals by hand after the Director picks candidates.

## Sources

Libraries
- Freesound FAQ: https://freesound.org/help/faq/
- Freesound API overview: https://freesound.org/docs/api/overview.html
- Freesound API resources (search filters, fields, OAuth2 downloads): https://freesound.org/docs/api/resources_apiv2.html
- Freesound API terms of use: https://freesound.org/help/tos_api/
- Freesound sound pages linked in the starter list (licence, format, duration read from each page)
- OpenGameArt: https://opengameart.org/content/rain-on-window-loop and https://opengameart.org/content/30-cc0-sfx-loops
- Kenney support (CC0 statement): https://kenney.nl/support
- Pixabay Terms of Service, Content License: https://pixabay.com/service/terms/ and summary https://pixabay.com/service/license-summary/
- Sonniss GDC bundle licence v2.0: https://sonniss.com/gdc-bundle-license/ and https://sonniss.com/gameaudiogdc
- Zapsplat licensing guide: https://www.zapsplat.com/copyright-and-audio-licensing-for-beginners (licence page itself is behind a JavaScript check)
- BBC Sound Effects: https://sound-effects.bbcrewind.co.uk/licensing (licence text behind JavaScript; only the landing text was readable)

Generation services
- ElevenLabs text-to-sound-effects API reference: https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert
- ElevenLabs sound effects capability docs: https://elevenlabs.io/docs/overview/capabilities/sound-effects
- ElevenLabs sound effects product page (plan table, free tier terms): https://elevenlabs.io/sound-effects
- ElevenLabs API pricing: https://elevenlabs.io/pricing/api
- ElevenLabs Pay As You Go: https://elevenlabs.io/docs/overview/administration/pay-as-you-go
- ElevenLabs Terms of Use: https://elevenlabs.io/terms-of-use
- fal.ai ElevenLabs Sound Effects v2: https://fal.ai/models/fal-ai/elevenlabs/sound-effects/v2 and /llms.txt
- fal.ai Stable Audio 3 Small SFX: https://fal.ai/models/fal-ai/stable-audio-3/small/sfx/base/text-to-audio/llms.txt
- fal.ai Mirelo SFX 2.0: https://fal.ai/models/mirelo-ai/sfx2.0/text-to-audio/llms.txt
- fal.ai pricing and terms: https://fal.ai/pricing and https://fal.ai/terms
- Stability AI pricing: https://docs.stability.ai/pricing
- Stability AI Stable Audio 2 / 2.5 text-to-audio: https://docs.stability.ai/api-reference/stable-audio-2/text-to-audio.md
- Stability AI Stable Audio 3 text-to-audio: https://docs.stability.ai/api-reference/stable-audio/text-to-audio.md
- Stability AI FAQ (commercial use): https://docs.stability.ai/faq.md
- Stability AI Terms of Service: https://stability.ai/2025-terms-of-service
- Stability AI Community License: https://stability.ai/community-license-agreement
- Stable Audio Open 1.0 model card: https://huggingface.co/stabilityai/stable-audio-open-1.0
