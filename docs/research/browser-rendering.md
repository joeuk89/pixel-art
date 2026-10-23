# Browser rendering options for a Scene engine left open all day

Research for [issue #6](https://github.com/joeuk89/pixel-art/issues/6). Written 2026-10-23. Every fact below is dated and cites the source that owns it. Library versions are as published on that date.

## Question

What should the Viewer render with, given it plays one animated pixel-art Scene for hours in a visible, hidden or fullscreen tab on a laptop that is often on battery? Compare Canvas 2D, raw WebGL and PixiJS on crisp integer scaling, layered parallax compositing, a few hundred rain or snow particles, flicker and glow light effects, bundle size on GitHub Pages, and above all CPU and battery cost. Also cover the Fullscreen API and autoplay rules for the Soundtrack.

## Recommendation

Use **Canvas 2D** at a fixed low internal resolution, with a hand-written layer compositor and a frame loop that the engine throttles itself. Keep raw WebGL as the upgrade path for one component only (a per-pixel light or palette pass) if a prototype shows Canvas 2D cannot do it cheaply. Do not adopt PixiJS for the Viewer.

Why Canvas 2D wins for this Scene engine:

- **The battery cost is set by the frame loop, not the API.** Every option wakes the CPU once per frame and asks the GPU to composite the canvas. The savings come from fewer frames, no work when hidden, and a small backing store. Those techniques (below) are API-independent, so the simplest API wins.
- **The workload is tiny.** A Scene is a handful of layers, a few hundred particles and some sprites at an internal resolution of a few hundred pixels across. Canvas 2D `drawImage` handles that in well under a millisecond per frame; WebGL's batching advantage only matters at thousands of draws.
- **Zero bundle, zero version churn.** Canvas 2D is part of the platform. PixiJS 8.22.0 is 925 KB minified / 265 KB gzipped for the full package ([Bundlephobia, fetched 2026-10-23](https://bundlephobia.com/package/pixi.js@8.22.0)); a tree-shaken sprite-only build is smaller but unmeasured. PixiJS v8 shipped ten minor releases between 2026-02-03 and 2026-10-01, several with behaviour changes ([releases](https://github.com/pixijs/pixijs/releases), fetched 2026-10-23).
- **Nothing to lose over eight hours.** A WebGL context can be lost and must be rebuilt (`webglcontextlost`). Canvas 2D needs no such handling.
- **Crisp pixels are one flag.** `ctx.imageSmoothingEnabled = false` is Baseline since April 2017 ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingEnabled)).

Trade-offs accepted:

- **Per-pixel effects are limited to compositing.** Glow and flicker become pre-rendered light sprites drawn with `globalCompositeOperation = 'lighter'` and an animated alpha. A true per-pixel pass (normal-mapped light, palette-constrained lighting, dithered fog) needs a fragment shader. Reading pixels back with `getImageData` every frame is the one thing Canvas 2D must never do: it forces a CPU copy per frame. If a prototype proves such a pass is wanted, add one WebGL full-screen quad with a small shader and keep everything else in Canvas 2D (or move the whole compositor to raw WebGL; the layer model stays the same).
- **No scene graph, ticker or asset loader.** The engine writes its own, a few hundred lines for this scope. PixiJS would give these for free but drags in its default WebGL renderer and `linear` texture filtering that must be overridden (see PixiJS notes).
- **Canvas 2D hardware acceleration is browser-controlled.** All three evergreen browsers accelerate it, but a browser can fall back to software on blocked GPUs. At this internal resolution software rendering is still cheap; measure it.

## Battery-saving techniques the engine must use

These apply whatever the rendering API.

1. **Drive the loop with `requestAnimationFrame`, never `setInterval`.** rAF is paused in background tabs by every major engine: MDN says calls "are paused in most browsers when running in background tabs or hidden `<iframe>`s" ([MDN rAF](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)); Chrome "does not call `requestAnimationFrame()` when a page is in the background" ([Chrome, 2017-03-09](https://developer.chrome.com/blog/background_tabs)); WebKit: "requestAnimationFrame is stopped" when a page is inactive ([WebKit, 2019-08-27](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/)). Timers are only throttled, so a timer-driven loop keeps waking the CPU for an invisible canvas.
2. **Cap the frame rate well below the display rate.** rAF fires at the display refresh rate, "most common 60hz, though 75hz, 120hz and 144hz are also widely used" ([MDN rAF](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)). On a 120 Hz laptop an uncapped loop doubles the wakeups for no visible gain in pixel art. Use the rAF timestamp as an accumulator and only draw when the target interval (24 to 30 fps for weather; 8 to 12 fps for sprite props) has elapsed. Never assume 16.67 ms per frame: Chrome 108's Energy Saver "conserves battery power by reducing the display refresh rate" and the Chrome team's advice is to drive animation from timestamps ([Chrome, Energy Saver](https://developer.chrome.com/blog/memory-and-energy-saver-mode)).
3. **Stop everything on `visibilitychange` to `hidden`, and reset the clock on `visible`.** rAF stops anyway, but the engine must also cancel its own pending frame, stop any timers, and on resume clamp the first delta so hours of accumulated time do not fast-forward the Scene. The Page Visibility API is Baseline since July 2015 ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)). WebKit's rule: "Drive CPU usage to zero in idle" and use Page Visibility to defer UI updates ([WebKit, 2019-08-27](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/)).
4. **Render at the house internal resolution and let the compositor scale.** Keep the canvas backing store at the Scene's native size (for example 320x180 or 480x270) and size it on screen with CSS and `image-rendering: pixelated`. The GPU then composites one small texture per frame. The alternative (a backing store at full device resolution and `drawImage` with smoothing off) multiplies fill work by the square of the scale; measure both (see "What a prototype should measure").
5. **Pre-render static layers once, composite per frame.** Background, buildings and other non-animating layers go to offscreen canvases at load. Each frame draws only the parallax offsets of those cached layers plus the live particles and props. WebKit: "don't call into the `<canvas>` APIs if the canvas content isn't changing" ([WebKit, 2019-08-27](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/)). If a frame has nothing to change (reduced motion, no weather), skip the draw.
6. **Make the canvas opaque.** `getContext('2d', { alpha: false })` tells the browser "the backdrop is always opaque, which can speed up drawing" ([MDN getContext](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext)). Leave `desynchronized` and `willReadFrequently` off; the first is for input latency, the second forces software rendering. If WebGL is ever used, pass `powerPreference: 'low-power'`, `antialias: false`, `depth: false`, `preserveDrawingBuffer: false` (same source).
7. **No per-frame allocation and no per-frame pixel readback.** Pool particles, reuse arrays, and never call `getImageData` or `putImageData` in the loop. Garbage collection pauses are CPU wakeups too.
8. **Honour `prefers-reduced-motion: reduce`** (Baseline since January 2020, [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)) by dropping particles and parallax to a still or slow state. This also lowers power.
9. **Suspend audio when it is not audible.** Keep one `AudioContext`; call `suspend()` while the Soundtrack is muted and `resume()` on unmute, so the audio thread sleeps. Note the knock-on effect in hidden tabs: Chrome exempts audible tabs from timer throttling and from Energy Saver freezing ([Chrome 57](https://developer.chrome.com/blog/background_tabs), [Chrome 133](https://developer.chrome.com/blog/freezing-on-energy-saver)). An unmuted Soundtrack in a hidden tab therefore keeps the tab alive, which is what a listener wants; the render loop is still stopped by rules 1 and 3.
10. **Survive freezing and discarding.** Chrome 133 (February 2025) freezes a tab that has been "hidden and silent for more than five minutes" and is CPU-intensive when Energy Saver is on; a frozen tab is "automatically unfrozen" on focus "without loss of state" ([Chrome, 2025-01-20](https://developer.chrome.com/blog/freezing-on-energy-saver)). Chrome has fired `freeze` and `resume` on `document` since Chrome 68 ([Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)). Memory Saver (Chrome 108) discards unused background tabs; the page reloads on return and `document.wasDiscarded` is `true` ([Chrome](https://developer.chrome.com/blog/memory-and-energy-saver-mode)). The Viewer should keep its state (which Scene, sound on or off) in the URL and `localStorage`, so a discard-and-reload lands back on the same Scene.
11. **Do not depend on the Battery Status API.** It exists in Chrome (since 38) but Firefox removed it in 52 and Safari never shipped it ([MDN BCD, fetched 2026-10-23](https://github.com/mdn/browser-compat-data/blob/main/api/BatteryManager.json)). An optional "lower fps on battery" in Chrome is fine; the defaults above must already be cheap.

## Hidden-tab behaviour by browser

| Behaviour | Chrome | Firefox | Safari / WebKit |
| --- | --- | --- | --- |
| `requestAnimationFrame` while hidden | Not called at all (rule since 2011) ([Chrome 57 post](https://developer.chrome.com/blog/background_tabs)) | Paused ("most browsers", [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)) | Stopped ([WebKit 2019](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/)) |
| Timers while hidden | Aligned to once per second; after 5 min hidden, chain depth 5+, silent 30 s and no WebRTC, once per minute (Chrome 88, Jan 2021) ([Chrome](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)); budget throttling after 10 s (Chrome 57) | Budget throttling after 30 s ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)) | Avoid wakeups in background; "CPU usage to zero in idle" ([WebKit 2019](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/)) |
| Audible tab | Exempt from throttling and freezing | Considered foreground, not throttled ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)) | Not documented in the sources read |
| Freeze / discard | Freeze after 5 min hidden and silent when CPU-intensive under Energy Saver (Chrome 133); discard under Memory Saver (Chrome 108) | Not documented in the sources read | Not documented in the sources read |

## Integer-scaled crisp pixels

**Scaling filters per API** (all fetched 2026-10-23):

- Canvas 2D: `ctx.imageSmoothingEnabled = false`; default is `true` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingEnabled)). Set it after any change to `canvas.width` or `canvas.height`, which reset context state.
- WebGL: `TEXTURE_MAG_FILTER` defaults to `LINEAR`, `TEXTURE_MIN_FILTER` defaults to `NEAREST_MIPMAP_LINEAR`; set both to `NEAREST` per texture ([MDN texParameter](https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/texParameter)).
- PixiJS 8.22.0: `TextureStyle.defaultOptions.scaleMode` is `'linear'` ([source](https://github.com/pixijs/pixijs/blob/v8.22.0/src/rendering/renderers/shared/texture/TextureStyle.ts)); set it to `'nearest'` globally or `texture.source.scaleMode = 'nearest'` per texture. Renderer defaults: `resolution: 1`, `roundPixels: false`, `autoDensity: false`, `antialias: false` ([AbstractRenderer](https://github.com/pixijs/pixijs/blob/v8.22.0/src/rendering/renderers/shared/system/AbstractRenderer.ts), [ViewSystem](https://github.com/pixijs/pixijs/blob/v8.22.0/src/rendering/renderers/shared/view/ViewSystem.ts)). Pixel art wants `roundPixels: true`.

**CSS `image-rendering`** ([MDN BCD, fetched 2026-10-23](https://github.com/mdn/browser-compat-data/blob/main/css/properties/image-rendering.json)):

- `pixelated`: Chrome 41, Firefox 93, Safari 10 (iOS mirrors Safari).
- `crisp-edges`: Safari 7, Firefox 65, Chrome 148 unprefixed (alias `-webkit-optimize-contrast` since Chrome 13).
- Use `image-rendering: pixelated;` with `image-rendering: crisp-edges;` declared before it as the fallback.
- MDN's definition matters for the engine: `pixelated` scales "to the nearest integer multiple of the original image size, then uses smooth interpolation to bring the image to the final desired size" ([MDN image-rendering](https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering)). Only an exact integer multiple in **device** pixels is fully crisp.

**devicePixelRatio handling.** `window.devicePixelRatio` is "the ratio of the resolution in physical pixels to the resolution in CSS pixels"; 2 on Retina, non-integer values occur, and it changes when the window moves to another display, observable via a `matchMedia('(resolution: Ndppx)')` change event ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio)). The engine must:

1. Compute `scale = floor(min(viewportW * dpr / sceneW, viewportH * dpr / sceneH))`, minimum 1.
2. Size the canvas on screen at `sceneW * scale / dpr` by `sceneH * scale / dpr` CSS pixels and letterbox the remainder (a Scene-coloured or black border). On DPR 1.25 or 1.5 (common Windows laptops) this CSS size is fractional; whether the browser snaps it to whole device pixels is a thing to measure.
3. Recompute on `resize`, `fullscreenchange` and the `matchMedia` resolution change.

## Capability comparison

| Need | Canvas 2D | Raw WebGL | PixiJS 8.22.0 |
| --- | --- | --- | --- |
| Crisp integer scaling | `imageSmoothingEnabled=false` + CSS `pixelated` | `NEAREST` filters + CSS `pixelated` | `scaleMode: 'nearest'`, `roundPixels: true`; `autoDensity`/`resolution` for DPR |
| Layered parallax | `drawImage` of cached layer canvases with offsets | One textured quad per layer | `Container` per layer |
| A few hundred particles | `drawImage` or `fillRect` per particle; trivial at internal res | Instanced or batched quads | `ParticleContainer` with `dynamicProperties` (position dynamic by default) ([source](https://github.com/pixijs/pixijs/blob/v8.22.0/src/scene/particle-container/shared/ParticleContainer.ts)) |
| Flicker and glow | Pre-rendered light sprites with `'lighter'` composite and animated alpha; no per-pixel pass | Fragment shader: per-pixel light, palette lock, dithering | Filters (`BlurFilter` and others) run as full-resolution passes: fine visually, costly on battery |
| Bundle on GitHub Pages | 0 KB library | 0 KB library, more engine code | 925 KB min / 265 KB gzip full package ([Bundlephobia](https://bundlephobia.com/package/pixi.js@8.22.0)); tree-shakeable subpath exports exist |
| Long-run risk | None specific | Context loss must be handled | Context loss handled by the library; WebGPU "feature complete" but WebGL "recommended for production"; Canvas renderer experimental ([renderers guide](https://pixijs.com/8.x/guides/components/renderers), [v8.16.0 notes](https://github.com/pixijs/pixijs/releases)) |
| Frame cap | Own accumulator on rAF | Own accumulator on rAF | `Ticker.maxFPS` (default 0, unlimited) and `minFPS`; the ticker is rAF-based so it pauses when hidden ([Ticker source](https://github.com/pixijs/pixijs/blob/v8.22.0/src/ticker/Ticker.ts)) |

PixiJS notes for the record: `autoDetectRenderer` tries renderers in the order `['webgl', 'webgpu', 'canvas']` unless `preference` says otherwise ([source](https://github.com/pixijs/pixijs/blob/v8.22.0/src/rendering/renderers/autoDetectRenderer.ts)); `powerPreference` is `undefined` by default ([GlContextSystem](https://github.com/pixijs/pixijs/blob/v8.22.0/src/rendering/renderers/gl/context/GlContextSystem.ts)). If PixiJS were adopted, the engine would still need every technique in the battery list; the library saves scene-graph code, not power.

## Fullscreen API facts

- `element.requestFullscreen()` returns a promise and **requires transient user activation**: "The user has to interact with the page or a UI element in order for this feature to work" ([MDN requestFullscreen](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen)). Transient activation "is expected be at most a few seconds" after the gesture ([HTML spec](https://html.spec.whatwg.org/multipage/interaction.html#tracking-user-activation)). Call it directly inside the click handler, not after an await or asset load.
- Options: `navigationUI: 'auto' | 'hide' | 'show'` (default `auto`); `screen` for multi-monitor ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen)).
- Users leave with Esc or F11, by switching tabs, or by switching apps; listen for `fullscreenchange` on the element and recompute the integer scale, and show a hint that Esc exits ([MDN Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API)).
- `document.fullscreenElement` is `null` when windowed; `document.fullscreenEnabled` is `false` when the `fullscreen` Permissions Policy or the platform forbids it. The default allowlist is `self`, which a GitHub Pages top-level document satisfies ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API)).
- Support ([MDN BCD, fetched 2026-10-23](https://github.com/mdn/browser-compat-data/blob/main/api/Element.json)): Chrome 71, Firefox 64, Safari 16.4 unprefixed (`webkitRequestFullscreen` since Safari 5.1). **iPhone Safari does not support it for arbitrary elements**; iPad Safari does (16.4) but "shows an overlay button which can not be disabled" and "swiping down exits fullscreen mode". On iPhone the Viewer must fall back to a plain full-viewport layout.
- Fullscreen is also an ideal moment to unmute: the same click supplies both the transient activation for fullscreen and the sticky activation for audio.

## Autoplay facts for the Soundtrack

**Rules.** Muted autoplay is always allowed; audible playback needs user interaction. MDN: media may autoplay only if "the audio is muted or its volume is set to 0", or "the user has interacted with the site (by clicking, tapping, pressing keys, etc.)", or the site is allowlisted by engagement or preferences ([MDN Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)). Chrome: "Muted autoplay is always allowed"; sound is allowed after the user "has interacted with the domain (click, tap, etc.)", or after the Media Engagement Index threshold, or for an installed PWA (policy since Chrome 66, April 2018) ([Chrome](https://developer.chrome.com/blog/autoplay)). Safari: "Websites should assume any use of `<video>` or `<audio>` requires a user gesture click to play"; users can also block a site per-site in Safari preferences ([WebKit, 2017-06-08](https://webkit.org/blog/7734/auto-play-policy-changes-for-macos/)).

**What counts as the gesture.** The HTML spec lists the activation-triggering events: trusted `keydown` (not Esc or browser shortcuts), `mousedown`, `pointerdown` with a mouse, `pointerup` with touch or pen, and `touchend` ([HTML spec](https://html.spec.whatwg.org/multipage/interaction.html#tracking-user-activation), [MDN User activation](https://developer.mozilla.org/en-US/docs/Web/Security/User_activation)). Scrolling and mouse movement are not in the list and do not count. Autoplay of "Media and Web Audio APIs (in particular for `AudioContext`s)" is gated on **sticky** activation, which "persists until the end of the session" once set ([MDN User activation](https://developer.mozilla.org/en-US/docs/Web/Security/User_activation)). `navigator.userActivation.hasBeenActive` reports it.

**Web Audio specifics.** An `AudioContext` created before a gesture "will be created in the `suspended` state, and you will need to call `resume()` after the user gesture" (Chrome 71 onwards); check `AudioContext.state` ([Chrome](https://developer.chrome.com/blog/autoplay)). Calling `start()` on a source node "outside the context of handling a user input event is subject to autoplay rules" ([MDN Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)). Rejected `play()` promises carry `NotAllowedError`; the fix is to show a play control ([MDN Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)).

**Does the unmuted state persist across Scenes?** Yes within one document, not reliably across page loads:

- The HTML spec keeps the activation timestamp on the `Window`: "sticky activation state spans multiple navigations as long as the same Document gets reused" ([HTML spec](https://html.spec.whatwg.org/multipage/interaction.html#tracking-user-activation)). A full navigation to a new Scene URL creates a new Document and the browser applies its own policy again. Chrome's wording ("interacted with the domain") and its engagement index make audible autoplay likely on a return visit; Firefox and Safari give no such promise, and Safari grants playback "on a per-element basis" ([WebKit 2017](https://webkit.org/blog/7734/auto-play-policy-changes-for-macos/)).
- So the Viewer should be **one document that swaps Scenes without navigating** (update the URL with `history.pushState` so Share links still work), keep **one `AudioContext`** (or one `<audio>` element whose `src` is swapped, which is WebKit's recommendation) alive across Scenes, and store the "sound on" choice in `localStorage` so a fresh load can unmute on the first gesture without asking again.

**Seamless loops.** `AudioBufferSourceNode.loop` with `loopStart`/`loopEnd` loops a decoded buffer inside the audio thread ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/loop)); the `<audio loop>` element re-seeks the media pipeline. Whether `<audio loop>` is gapless in each browser is a thing to measure. Web Audio also gives the muted-suspend behaviour from battery rule 9.

## What a prototype should measure

1. **Energy per renderer.** Same Scene, Canvas 2D versus raw WebGL, at 30 fps and uncapped, windowed and fullscreen, for at least ten minutes each. Record macOS `powermetrics` (or Activity Monitor "Energy Impact") plus CPU and GPU percent. This is the only way to confirm the recommendation.
2. **Compositor scaling versus drawn scaling.** Small backing store with CSS `pixelated` versus a full-device-resolution backing store with `imageSmoothingEnabled=false`. Check both power and crispness on DPR 2 (Mac) and DPR 1.25 / 1.5 (Windows), including whether fractional CSS sizes snap cleanly.
3. **Particle ceiling.** How many `drawImage` particles Canvas 2D sustains at the house internal resolution within a 30 fps budget on an integrated GPU, and the frame-time distribution.
4. **Glow via `'lighter'` composite.** Does the pre-rendered light sprite approach look right at the chosen palette, or is a shader pass required?
5. **Hidden-tab CPU.** Confirm near-zero CPU after `visibilitychange`, and that the Scene resumes correctly after a Chrome Energy Saver freeze and a Memory Saver discard (`chrome://discards` can trigger both).
6. **Eight-hour soak.** Heap stays flat (no per-frame allocation growth), no WebGL context loss if WebGL is used, animation phase still correct after a long hidden period.
7. **Soundtrack loop gap.** `<audio loop>` versus `AudioBufferSourceNode.loop` in Chrome, Firefox and Safari.
8. **Safari specifics.** Fullscreen on iPad and the iPhone fallback layout; unmute flow after a cold load.
