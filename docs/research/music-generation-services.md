# Music generation services for seamless ambient Soundtrack loops

Resolves [issue #4](https://github.com/joeuk89/pixel-art/issues/4). Researched 2026-10-23 against official pricing pages, API docs and terms. Prices are USD as published, with GBP at about 0.77 GBP/USD. Anything marked *unverified* needs a prototype or a support ticket to settle.

## Answer in brief

**Prototype Stable Audio 3.0 (Stability AI platform API) first, with Google Lyria 3.5 (Gemini API) as the second candidate.** Both are pay-as-you-go with no subscription, both cost about £0.06 per full-length track, both return WAV or MP3 at 44.1 kHz stereo, and both grant commercial use of the output. Stable Audio wins on control: an explicit `duration` (1–380 s), an instrumental-first model, and `audio-to-audio` plus `inpaint` endpoints that can repair a loop seam natively. Lyria 3.5 is the cheaper, higher-polish fallback but controls length and instrumentation by prompt only.

No surveyed service makes a guaranteed seamless loop. The Soundtrack pipeline should always run the output through the code loop-maker in the last section: cut a beat-aligned region, crossfade the tail into the head, store sample-accurate loop points in the Scene plan, and loop in the Viewer with `AudioBufferSourceNode`, which the Web Audio spec defines as gapless.

Red flags: ElevenLabs Music needs a paid subscription for API access (fails the no-monthly-minimum constraint); Suno has no official API and the "Suno API" vendors are unofficial wrappers; MusicGen weights are CC-BY-NC 4.0, so it is fine for this non-monetised project but blocks any later commercial turn.

## Comparison

Cost column is for one 120 s track. "PAYG" means usage-billed with no subscription or monthly minimum.

| Service | PAYG | Cost / 120 s | Max length | Loop / extend | Instrumental | Output | Public playback on Share links | API, Node SDK |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Stable Audio 3.0** (Stability platform) | Yes, prepaid credits, 1 credit = $0.01, 25 free | 8 credits = $0.08 (£0.06) flat, any length | 380 s (`duration` 1–380, default 190) | No loop flag. `audio-to-audio` (strength 0–1), `inpaint` (`mask_start`/`mask_end`), and continuation to a chosen length | Model "designed primarily for instrumental work"; no flag, prompt-driven | `mp3` or `wav`, 44.1 kHz stereo | Yes: FAQ says outputs may be used commercially; ToS assigns Output rights to you; must not imply human-made | REST `/v2beta/audio/stable-audio/text-to-audio`, async (202 + poll). No official SDK; docs show `axios` + `FormData` |
| **Stable Audio 2.5** (Stability platform) | Same | 8 credits = $0.08 (£0.06) | 190 s | `audio-to-audio`, `inpaint` | Prompt-driven | `mp3`/`wav` 44.1 kHz | Same | Same shape (`/v2beta/audio/stable-audio-2/...`) |
| **Google Lyria 3.5** (Gemini API, Interactions API) | Yes, billing account, no minimum | $0.08 per song (£0.06) | "A couple of minutes", steered by prompt (no `duration` param) | None: "single-turn", no extend or edit | Prompt only ("Instrumental only, no vocals") | MP3 default, WAV via `response_format`; 44.1 kHz stereo; SynthID watermark | Yes: Gemini terms say Google won't claim ownership of output; Prohibited Use Policy bans passing it off as human-made | REST; official `@google/genai` SDK (`client.interactions.create`) |
| **Google Lyria 3 Clip** (`lyria-3-clip-preview`) | Yes | $0.04 (£0.03) per fixed 30 s clip | 30 s only | Marketed for "short musical clips, loops" | Prompt only | MP3 | Same | Same |
| **Google Lyria 2** (`lyria-002`, Vertex AI, GA; also on fal at $0.10/30 s) | Yes | About $0.40 (£0.31) for 4 clips to stitch (fal price; Vertex price row not found) | 32.8 s clips, up to 4 per prompt | None | Model card lists vocal and lyric generation as unsupported | WAV 48 kHz | Google Cloud terms | Vertex REST / `@google/genai`; fal `@fal-ai/client` |
| **Lyria RealTime** (`lyria-realtime-exp`) | Experimental, no price row | Unknown | Continuous stream | Steerable live stream; could be recorded server-side | Instrumental | 16-bit PCM 48 kHz stereo | "Experimental models are not stable and availability of model endpoints is subject to change" | WebSocket via `@google/genai` `live.music` |
| **ElevenLabs Music** (`music_v2_5`) | **No for the API**: music terms say API access is Starter+ ($6/mo); Music API "available for paid subscribers" | $0.15/min → $0.30 (£0.23) on top of the plan | 3 s–600 s (`music_length_ms`) | Inpainting in the UI; `store_for_inpainting` flag; no loop or extend in the API | `force_instrumental: true` guaranteed | `mp3_44100_128` … `mp3_48000_320`, `pcm_*`, `opus_48000_*` | Starter+: "All online and offline commercial use permitted, except film, TV, radio, and Studio Games"; no attribution. Free tier: individual use, attribution, no downloads | REST, sync (returns file); official `@elevenlabs/elevenlabs-js` |
| ElevenLabs Music via **fal.ai** | Yes | $0.60 per output minute rounded up → $1.20 (£0.92) | As above | As above | As above | MP3 | fal page tags "Commercial use"; licence chain to ElevenLabs music terms *unverified* | `@fal-ai/client` queue |
| **MusicGen** (`meta/musicgen`, Replicate) | Yes, per-second GPU billing (A100 $0.0014/s), no minimum | About $0.05–0.10 per 30 s run; 120 s needs chained `continuation` runs, about $0.30 (£0.23) | 30 s per run | `continuation` input extends from an existing clip; the standard way to build longer tracks and to generate a tail that resolves into the head | Model only makes instrumental music | WAV or MP3, 32 kHz (stereo variants available) | Weights are **CC-BY-NC 4.0**. Replicate ToS: commercial use of output "subject to any Third Party Terms (as determined by the Models you use)". Fine for a non-monetised personal Share link, blocks commercial use | REST async; official `replicate` npm |
| MusicGen on **fal.ai** | Yes | n/a | n/a | n/a | n/a | n/a | fal has no first-party MusicGen endpoint today; it offers `fal-ai/stable-audio-25/text-to-audio` ($0.20), `fal-ai/lyria2` ($0.10/30 s), `fal-ai/elevenlabs/music` ($0.60/min) | `@fal-ai/client` |
| **Suno** | No official public API; consumer plans only | n/a | Up to about 8 min in the app | "Extend" in the app | "Instrumental" toggle in the app | MP3/WAV in the app | Commercial rights come with Pro/Premier subscriptions, so the no-monthly-minimum constraint fails; third-party "Suno API" wrappers break Suno's ToS and give no licence chain | None official |
| **Udio** | No official public API | n/a | App only | "Extend" in the app | App toggle | App download | Subscription-based commercial rights, as with Suno | None official |

Suno and Udio details are in their own section below; neither is a candidate while they have no official API.

## Service notes

### Stable Audio 3.0 and 2.5 (Stability AI platform)

Source: [Pricing](https://docs.stability.ai/pricing), [Text-to-Audio (3.0)](https://docs.stability.ai/api-reference/stable-audio/text-to-audio), [Audio-to-Audio (3.0)](https://docs.stability.ai/api-reference/stable-audio/audio-to-audio), [Inpaint (3.0)](https://docs.stability.ai/api-reference/stable-audio/inpaint), [Text-to-Audio (2.x)](https://docs.stability.ai/api-reference/stable-audio-2/text-to-audio), [Prompt guide](https://docs.stability.ai/stable-audio), [FAQ](https://docs.stability.ai/faq), [Terms of Service](https://stability.ai/2025-terms-of-service). Checked 2026-10-23.

- Billing: prepaid credits, 1 credit = $0.01, 25 free credits to start. No subscription. Minimum top-up not stated on the pricing page.
- Cost: Stable Audio 3.0 and 2.5 are a flat 8 credits ($0.08, about £0.06) per successful generation regardless of duration. Stable Audio 2.0 costs `17 + 0.06 × steps` credits (20 at the default 50 steps).
- Length: 3.0 `duration` 1–380 s (default 190). 2.5 up to 190 s. Both 44.1 kHz stereo.
- Parameters (3.0 text-to-audio): `prompt`, `duration`, `seed`, `steps` 4–8, `cfg_scale` 1–25 (default 1), `output_format` `mp3` | `wav`.
- Audio-to-audio: same plus `audio` (6–380 s input) and `strength` 0–1. Inpaint: `mask_start`/`mask_end` in seconds; regenerates that region in context. The prompt guide's "Continuation: Extend the length" shows extending a 3 s clip to 100 s. These are what make Stable Audio the best fit for loops: see method B below.
- Instrumental: "Stable Audio 3.0 is designed primarily for instrumental work. It can sometimes create non-lexical vocal-like textures, but it is not intended to generate intelligible vocals." No flag; put "instrumental" in the prompt.
- API shape: `POST https://api.stability.ai/v2beta/audio/stable-audio/text-to-audio` (multipart form, Bearer key) returns 202 with an `id`; poll `GET /v2beta/audio/results/{id}` (202 while running, 200 with bytes or base64 JSON when done). Results kept 24 h. Rate limit 150 requests per 10 s. No official Node SDK; the docs' JavaScript example uses `axios` and `form-data`, so a small typed wrapper is needed.
- Terms: FAQ, "Can I use the API outputs for commercial purposes? Yes, as long as the output doesn't violate anyone's copyright." ToS §4a: Stability will "assign to you all of our right, title, and interest (if any) in the Outputs" and "you own the Output (to the extent permitted by applicable law)". §3b(8) bars implying an Output was "human-generated". No revenue threshold in the ToS. Training data: "Stable Audio models were exclusively trained on licensed data from the AudioSparx music library" and Freesound (docs), which lowers copyright risk for public playback.
- Open point: the Stability Community License (open-weights models, $1M revenue threshold) does not apply to the hosted API; the hosted API runs under the 2025 ToS above. *Unverified*: whether a supplemental "Platform" terms document exists at platform.stability.ai that changes anything; the FAQ points only to the main ToS.

### Google Lyria (Gemini API and Vertex AI)

Source: [Music generation guide](https://ai.google.dev/gemini-api/docs/music-generation), [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), [Models](https://ai.google.dev/gemini-api/docs/models), [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Gemini API terms](https://ai.google.dev/gemini-api/terms), [Generative AI Prohibited Use Policy](https://policies.google.com/terms/generative-ai/use-policy). Checked 2026-10-23.

- Models and prices (paid tier, per request; no free tier for any Lyria model): `lyria-3.5` $0.08 per song; `lyria-3-clip-preview` $0.04 per 30 s clip; `lyria-3-pro-preview` $0.08 per song. The models page dates 2026-10-22.
- Billing: pay-as-you-go once a billing account is linked (Tier 1). No minimum spend. Tier 1 has a spend-rate cap of $10 per 10 minutes, irrelevant at this volume.
- Length: Lyria 3.5 makes "a couple of minutes (controllable using prompt)" with no `duration` parameter; you ask for "a 2-minute piece" or give timestamped sections. Lyria 3 Clip "always generates a 30-second clip" and is pitched at "short musical clips, loops, and previews".
- Instrumental: prompt only, e.g. "Instrumental only, no vocals." Lyria 3.5 can also write and sing lyrics, so the brief must forbid them explicitly.
- Output: MP3 by default, WAV for Lyria 3.5 via `response_format` (exact field value not shown in the docs, *unverified*). 44.1 kHz stereo. Every file carries a SynthID audio watermark. "Music generation is a single-turn process": no extend, inpaint or loop.
- API shape: Interactions API via the official `@google/genai` SDK: `client.interactions.create({ model: 'lyria-3.5', input, response_format: { type: 'audio' } })`, audio returned base64 in `interaction.output_audio.data`.
- Terms: "Google won't claim ownership over that content" (generated output). Paid services: "Google doesn't use your prompts … or responses to improve our products". "You're responsible for your use of generated content, and for the use of that content by anyone you share it with." Use policy forbids "misrepresenting AI-generated content as solely human-made" and impersonating artists. Nothing restricts public playback on a website. Note the terms say the API is "for developers building with Google AI models for professional or business purposes, not for consumer use"; a personal developer project using the API is the intended audience, but it is worth knowing.
- Lyria 2 (`lyria-002`, Vertex AI, GA since 2025-10-27; also `fal-ai/lyria2` at $0.10 per 30 s) makes WAV clips of at most 32.8 s at 48 kHz, up to 4 per prompt, text-only input with negative prompting; the model card lists vocal and lyric generation as unsupported and no audio watermarking. Four clips would need stitching; superseded by Lyria 3.5 for this use.
- Lyria RealTime (`lyria-realtime-exp`) streams 16-bit 48 kHz stereo PCM over a WebSocket with live controls (bpm, density, brightness, scale). It has no pricing row and "experimental models are not stable". A Node recorder could capture any length, but it is not a production dependency.

### ElevenLabs Music

Source: [Compose endpoint](https://elevenlabs.io/docs/api-reference/music/compose), [Music capability overview](https://elevenlabs.io/docs/overview/capabilities/music), [API pricing](https://elevenlabs.io/pricing/api), [Music terms](https://elevenlabs.io/music-terms), [fal endpoint](https://fal.ai/models/fal-ai/elevenlabs/music). Checked 2026-10-23.

- Cost: API pricing table lists Music at $0.15 per output minute, so 2 min = $0.30 (about £0.23). The FAQ on the same page says music is "billed per generation", a conflict to settle before relying on the figure.
- Billing gate: the capability page says the "Music API is available for paid subscribers". The music terms' Commercial Rights Table gives API access "No" on Free and "Yes" from Starter ($6/mo, first month $1). The API pricing page advertises a "Free / Pay as you go" tier, but neither page says that tier counts as a paid plan for Music. **This fails the no-monthly-minimum constraint unless the pay-as-you-go tier is confirmed to include Music API access.**
- Length: `music_length_ms` 3,000–600,000. `force_instrumental: true` guarantees no vocals. Models `music_v1`, `music_v2`, `music_v2_5`.
- Output: `output_format` from `mp3_44100_128` and `mp3_48000_128`…`320` to `pcm_8000`…`pcm_48000` and `opus_48000_32`…`192`. Sync endpoint returns the file. Optional `sign_with_c2pa`.
- Loop/extend: none in the API. Inpainting exists in the UI (`store_for_inpainting` flag on the API hints at an inpaint endpoint, *unverified*). A `composition_plan` with sections could ask for a steady texture with no intro or outro.
- Terms (Exhibit A): Starter and above get "All online and offline commercial use permitted, except film, TV, radio, and Studio Games" with "No Attribution Required". "Music Streaming Distribution" (defined as "making Output available on a music streaming platform") is prohibited below Creator; a Share link on a personal site is not a music streaming platform. "For Individual Use Only" on all self-serve tiers suits a personal project. "Output remains subject to the plan in effect when that Output was created" after a downgrade, so tracks made on a one-month Starter plan keep their rights.
- SDK: official `@elevenlabs/elevenlabs-js`.
- Via fal: `fal-ai/elevenlabs/music` costs $0.60 per output minute rounded up (2 min = $1.20, about £0.92), PAYG. Whether fal's reseller terms carry ElevenLabs' Starter-tier music rights is *unverified*.

### MusicGen (Meta) on Replicate and fal.ai

Source: [meta/musicgen](https://replicate.com/meta/musicgen), [Replicate pricing](https://replicate.com/pricing), [Replicate terms](https://replicate.com/terms), [fal text-to-audio catalogue](https://fal.ai/models?categories=text-to-audio), [fal terms](https://fal.ai/terms). Checked 2026-10-23.

- Replicate: pay-as-you-go, "You only pay for what you use", no minimum. `meta/musicgen` runs on an A100 80 GB at $0.0014/s, about $0.046 per default run (page estimate, 21 runs per $1), finishing in about 33 s for a short clip. Model versions `melody` (1.5B, text + audio prompt) and `large` (3.5B); stereo variants exist. Output WAV or MP3 at 32 kHz. Each run makes up to 30 s; `continuation` takes an existing clip and continues it, which is how longer tracks are built and how a tail that resolves into the head can be generated.
- Licence: Audiocraft code MIT, Replicate wrapper Apache-2.0, **weights CC-BY-NC 4.0**. Replicate §5.1 grants output "for commercial purposes such as sale or publication" but "subject to any Third Party Terms (as determined by the Models you use to generate the Output)", and §3.1 requires compliance with "the applicable Model licenses referenced on the Model page". A non-monetised personal Share link is non-commercial use, so it is allowed; any sponsorship, ads or sale later would not be. Whether CC-BY-NC's attribution duty reaches generated output is legally unsettled; an "Music: MusicGen (Meta)" line in the Viewer would be cheap insurance.
- Quality: 32 kHz mono/stereo and 30 s chunks are a step down from Stable Audio and Lyria; chained continuations drift.
- fal.ai: no first-party MusicGen endpoint in the text-to-audio catalogue today. fal's relevant music endpoints are `fal-ai/stable-audio-25/text-to-audio` ($0.20 per generation, WAV), `fal-ai/lyria2` ($0.10 per 30 s, WAV) and `fal-ai/elevenlabs/music` ($0.60 per minute). fal is usage-billed with no minimum. fal's terms do not clearly assign output ownership (§4(c) only says fal gains no IP in output) and make you responsible for any third-party model terms (§14(b)). Going direct to Stability or Google is cheaper and gives a cleaner licence chain.

### Suno and Udio

Source: see the sources list; checked 2026-10-23.

Source: [Suno Terms of Service](https://suno.com/terms), [Music Business Worldwide, Suno explores developer API (2026-07)](https://musicbusinessworldwide.com/suno-explores-developer-api-seeking-apps-that-unlock-experiences-generative-music-makes-possible-for-the-first-time), [Digital Music News, Suno API partner program (2026-07-03)](https://www.digitalmusicnews.com/2026/07/03/suno-is-opening-an-api-partner-program/), [Udio Terms of Service](https://www.udio.com/terms-of-service), [apis.io Udio listing](https://apis.io/providers/udio/). Checked 2026-10-23.

**Suno has no public API.** In July 2026 its CPO posted an intake form for a "curated group of partners" with early access and no launch timeline. Everything sold as a "Suno API" (sunoapi.org, apibox, musicapi and similar) is an unofficial wrapper around the consumer app. Suno's ToS forbids "data mining, robots, scraping, or similar data gathering or extraction methods" and says "Obtaining a copy of an Output by any means other than a download channel made available by Suno is prohibited", so tracks fetched through a wrapper have no licence chain and the account can be closed. Rights in the app itself: Pro/Premier subscribers get "all of its right, title and interest in and to any Output owned by Suno" and may use downloaded output commercially; Free/Basic users may use output only for "personal and non-commercial purposes". Both routes need a monthly subscription, which fails the pay-as-you-go constraint. Watermarks and metadata must stay intact.

**Udio has no public API either.** Third-party directories (apis.io, May 2026) report no developer API and only consumer web and app products; the wrappers that exist (for example udioapi.pro) reverse-engineer the app and break when session handling changes. Udio's terms page would not render for this research (title only), so its ownership and commercial clauses are *unverified*; like Suno, its commercial rights are tied to paid subscription tiers rather than per-track billing.

Neither is a candidate until an official, usage-billed API exists. If Suno's partner programme opens up, revisit: its "Extend" feature and 8-minute songs would make long seamless loops easier.

## Shortlist

1. **Stable Audio 3.0 via the Stability platform API.** Prepaid credits with no subscription; £0.06 per track of any length up to 380 s; explicit `duration`; instrumental-first model trained on licensed stock music; WAV output for clean loop-making; `inpaint` and `audio-to-audio` can regenerate the seam musically. Costs about 2 credits' worth of risk per retry, so the Director can afford several attempts inside the £2 Scene budget. Weak points: no official SDK (a 60-line fetch wrapper), async polling, generation time scales with length.
2. **Google Lyria 3.5 via the Gemini API.** Same price, pay-as-you-go on a billing account, official `@google/genai` SDK, highest expected musical quality. Weak points: length and instrumentation by prompt only, no editing or extension, SynthID watermark (harmless here), model can sing unless told not to.

Runner-up: ElevenLabs Music, only if the pay-as-you-go tier is confirmed to include Music API access; it has the best controls (`force_instrumental`, exact `music_length_ms`, Opus output) but otherwise needs a $6/month plan.

Not shortlisted: MusicGen (quality and CC-BY-NC), Lyria 2 and Lyria 3 Clip (30 s clips need stitching), Lyria RealTime (experimental, unpriced), Suno and Udio (no official API).

## Fallback: making a seamless loop in code

No service returns a guaranteed loop, so the Soundtrack step always post-processes. Two methods; prototype A first, B if A's seams are audible on sparse ambient material.

### Method A: beat-aligned cut, tail crossfaded into head

1. **Generate longer than needed.** Ask for `L + X + margin` seconds (for a 120 s loop with a 4 s crossfade, request about 135 s). Models usually fade in and resolve at the end, so discard the first and last 5–10 s. Prompt for "steady, loopable, no intro, no outro, no build, constant texture".
2. **Pick the loop region [S, E).** Estimate tempo and beats with [`@audio/beat`](https://www.npmjs.com/package/@audio/beat) (MIT, 3.1.0, published 2026-10-17; onset detection, tempo estimation and beat tracking in Node) or the older [`music-tempo`](https://www.npmjs.com/package/music-tempo) (MIT, Beatroot algorithm, 2017). Snap `E - S` to a whole number of bars so the downbeat lands on the seam. Ambient tracks often have no detectable beat; then choose `S` and `E` where RMS is lowest and spectra are most similar, and use a longer crossfade (3–8 s).
3. **Crossfade the tail into the head.** Take `tail = audio[E, E+X)` and `body = audio[S, E)`. Fade `tail` out while fading `body`'s first `X` seconds in (equal-power curve), replace the head with the mix. The loop now ends at `E`, whose natural continuation is `tail`, which is already blended into the start. ffmpeg does this in one filtergraph using [`atrim`, `asetpts` and `acrossfade`](https://ffmpeg.org/ffmpeg-filters.html):

   ```sh
   ffmpeg -i track.wav -filter_complex \
     "[0:a]atrim=start=E:end=E+X,asetpts=PTS-STARTPTS[tail];
      [0:a]atrim=start=S:end=E,asetpts=PTS-STARTPTS[body];
      [tail][body]acrossfade=d=X:c1=qsin:c2=qsin[out]" \
     -map "[out]" loop.wav
   ```

   `acrossfade` applies the fade "for specified duration near the end of first stream" with `overlap` on by default; `qsin`/`hsin` curves keep power constant across the seam (curve names are in the `afade` section). Output length is exactly `E - S`.
4. **Check the seam.** Render two loop iterations back to back (`aloop=loop=1:size=N` or concatenate in code), compute the sample difference at the join and listen. Reject and re-pick `S`/`E` if the discontinuity exceeds a threshold.
5. **Encode.** Ship MP3 at 44.1 kHz 128–192 kbps (about 1.4–2.9 MB for 120 s) or Opus. A 120 s 16-bit stereo WAV is about 21 MB: within the 100 MB per-file limit but wasteful against the 1 GB repo cap.

Node tooling (checked on the npm registry 2026-10-23):

- [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static) 5.3.0 (2025-11-14, GPL-3.0-or-later) ships an ffmpeg binary; spawn it with `child_process`/`execa`. [`fluent-ffmpeg`](https://www.npmjs.com/package/fluent-ffmpeg) 2.1.3 is marked **deprecated** ("Package no longer supported"), so build the argument list directly.
- Pure-TypeScript route without ffmpeg: [`audio-decode`](https://www.npmjs.com/package/audio-decode) 3.12.0 (2026-08-11, MIT) decodes MP3/WAV/OGG/Opus/FLAC to an `AudioBuffer`-like object in Node; do the trim and crossfade on `Float32Array`s (about 30 lines); write WAV with [`node-wav`](https://www.npmjs.com/package/node-wav) (MIT, 2016, stable) or `wav-encoder`; encode MP3 with [`@breezystack/lamejs`](https://www.npmjs.com/package/@breezystack/lamejs) (LGPL-3.0) or hand the WAV to `ffmpeg-static`.

### Method B: let the model compose the seam (Stable Audio only)

Rotate the track so the seam sits in the middle: `rotated = audio[M, end) + audio[0, M)`. Send it to `inpaint` with `mask_start`/`mask_end` covering a few seconds either side of the join and a prompt matching the track; the model regenerates a musical transition in context. Rotate back. The prompt guide warns that a mask that is "too small compared to the rest of the audio" may be ignored, so mask 8–15 s. Costs one extra generation (£0.06). `audio-to-audio` with low `strength` can also smooth a rough Method A result.

### Playback in the Viewer

- Loop with Web Audio, not `<audio loop>`. Decode once with `decodeAudioData`, then `source.loop = true; source.loopStart = s; source.loopEnd = e; source.start()`. The [Web Audio spec §1.9.5](https://webaudio.github.io/web-audio-api/#looping-AudioBufferSourceNode): "Loop endpoints have subsample accuracy … playback of the loop is interpolated to splice the beginning and end of the loop together just as if the looped audio occurred in sequential, non-looped regions of the buffer." Values are seconds in the buffer's sample rate.
- Store `loopStart`/`loopEnd` (in samples) in the Scene plan rather than relying on the file boundaries. MP3 adds encoder delay (576 samples for LAME) and pads to 1152-sample frames; modern browsers trim this in `decodeAudioData` ([Firefox 83+](https://bugzilla.mozilla.org/show_bug.cgi?id=1566389), Chrome, [Safari from macOS Monterey](https://bugs.webkit.org/show_bug.cgi?id=228215)) but explicit loop points remove the dependency. Background on MP3 framing: [compuphase, Gapless looping MP3 tracks](https://compuphase.com/mp3/mp3loops.htm).
- Opus has no frame-padding problem and is supported in iOS Safari 18.4+ ([caniuse](https://caniuse.com/opus)); MP3 remains the safe universal choice given explicit loop points.

## What a prototype should test

- Stable Audio 3.0 and Lyria 3.5 on the same three briefs (rain-on-window piano, night-market synth pad, forest flute): subjective quality, how often vocals or hard intros/outros appear, and generation latency at 130 s.
- Whether Lyria 3.5 honours a requested length within ±15 s and whether its WAV `response_format` value is documented or discoverable.
- Method A seam audibility on beatless ambient material, and the crossfade length (2 s vs 6 s) that hides it.
- Method B: whether `inpaint` on a rotated track gives a better seam than a crossfade for the same £0.06.
- Tempo detection reliability on ambient output (`@audio/beat` vs falling back to RMS/spectral similarity).
- Decoded loop gaplessness in Chrome, Firefox and iOS Safari with stored loop points.
- Stability minimum credit top-up and whether credits expire (not stated on the pricing page).
- ElevenLabs: a support question on whether the pay-as-you-go tier includes Music API access and which rights tier applies, in case the two shortlisted services disappoint.

## Licensing posture (feeds the open item in issue #1)

- Stable Audio: output owned by the user, commercial use allowed, trained on licensed data. Do not present tracks as human-made. No notice required.
- Lyria: Google claims no ownership, output is SynthID-watermarked, use policy bans passing it off as human-made. No notice required, but a small "Music generated with AI" line in the Viewer satisfies both services' spirit at no cost.
- MusicGen (if ever used): non-commercial only, attribution advisable.
- ElevenLabs (if ever used): Starter+ output needs no attribution; Free output does and may not be downloaded.

## Sources

- Stability AI: https://docs.stability.ai/pricing · https://docs.stability.ai/api-reference/stable-audio/text-to-audio · https://docs.stability.ai/api-reference/stable-audio/audio-to-audio · https://docs.stability.ai/api-reference/stable-audio/inpaint · https://docs.stability.ai/api-reference/stable-audio-2/text-to-audio · https://docs.stability.ai/stable-audio · https://docs.stability.ai/faq · https://stability.ai/2025-terms-of-service
- Google: https://ai.google.dev/gemini-api/docs/music-generation · https://ai.google.dev/gemini-api/docs/pricing · https://ai.google.dev/gemini-api/docs/models · https://ai.google.dev/gemini-api/docs/rate-limits · https://ai.google.dev/gemini-api/terms · https://policies.google.com/terms/generative-ai/use-policy
- ElevenLabs: https://elevenlabs.io/docs/api-reference/music/compose · https://elevenlabs.io/docs/overview/capabilities/music · https://elevenlabs.io/pricing/api · https://elevenlabs.io/music-terms
- Replicate and fal: https://replicate.com/meta/musicgen · https://replicate.com/pricing · https://replicate.com/terms · https://fal.ai/models/fal-ai/stable-audio-25/text-to-audio · https://fal.ai/models/fal-ai/lyria2 · https://fal.ai/models/fal-ai/elevenlabs/music · https://fal.ai/pricing · https://fal.ai/terms
- Loop making: https://ffmpeg.org/ffmpeg-filters.html · https://webaudio.github.io/web-audio-api/#looping-AudioBufferSourceNode · https://compuphase.com/mp3/mp3loops.htm · https://bugzilla.mozilla.org/show_bug.cgi?id=1566389 · https://bugs.webkit.org/show_bug.cgi?id=228215 · https://caniuse.com/opus · npm registry metadata for `ffmpeg-static`, `fluent-ffmpeg`, `audio-decode`, `node-wav`, `@audio/beat`, `music-tempo`, `@breezystack/lamejs`
- Suno and Udio: https://suno.com/terms · https://musicbusinessworldwide.com/suno-explores-developer-api-seeking-apps-that-unlock-experiences-generative-music-makes-possible-for-the-first-time · https://www.digitalmusicnews.com/2026/07/03/suno-is-opening-an-api-partner-program/ · https://www.udio.com/terms-of-service · https://apis.io/providers/udio/
- Lyria 2 model card (Vertex AI, GA 2025-10-27, 32.8 s clips, 48 kHz WAV, instrumental mode): https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/lyria/lyria-002
