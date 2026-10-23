# Scene engine prototype (wayfinder #12)

PROTOTYPE, throwaway. Does a Canvas 2D compositor with rain, lamp flicker, parallax and steam feel right, and stay cheap enough to leave open all day?

Run: `npm start` (builds `index.html` with the five Pro Flash Elements inlined and opens it), or double-click `index.html`.

- Internal resolution 192x120, integer-scaled to the window, `image-rendering: pixelated`.
- One loop; weather and props tick at their own frame caps; the frame is drawn only when a tick happened.
- Static layers (sky, tiled skyline, wall with the pane hole cut out, window, desk, props) are cached canvases. The window's two glass blues are keyed out so the skyline shows through.
- Rain, steam are pooled particles. Lamp glow is a pre-rendered four-step sprite under `lighter`. Twinkle flips a few warm skyline pixels every half second.
- Settings live in the URL hash and reload the page. `idle=1` runs the loop without drawing (cost baseline).
- Stats overlay top-left; `soak log` writes one line a minute (also to the console). Press H to hide the control bar.
