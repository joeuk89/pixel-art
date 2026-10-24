const CSS = `
html, body { margin: 0; height: 100%; }
body { background: #1d1826; color: #e8e0d0; font: 15px/1.4 system-ui, sans-serif; }
a { color: inherit; }
.gallery { padding: 24px 16px; }
.gallery ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 24px; }
.gallery a { display: flex; flex-direction: column; gap: 8px; text-decoration: none; }
.gallery img { image-rendering: pixelated; display: block; }
footer { padding: 16px; opacity: 0.7; font-size: 13px; }
.scene { position: fixed; inset: 0; display: grid; place-items: center; overflow: hidden; }
.scene > canvas, .scene > img { grid-area: 1 / 1; image-rendering: pixelated; display: block; }
.overlay { position: absolute; inset: 0 0 auto 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 16px;
  background: linear-gradient(#000a, #0000); visibility: hidden; opacity: 0; transition: opacity 0.3s, visibility 0.3s; }
.controls-shown .overlay { visibility: visible; opacity: 1; }
.overlay .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.overlay button, .overlay a { font: inherit; color: inherit; background: #0008; border: 1px solid #fff4; border-radius: 6px; padding: 6px 10px; cursor: pointer; text-decoration: none; }
.hint { position: absolute; right: 16px; bottom: 12px; margin: 0; padding: 4px 10px; border-radius: 6px; background: #0008; font-size: 13px; pointer-events: none; }
.scene:not(.controls-shown) { cursor: none; }
.missing { padding: 24px 16px; }
`;

export function injectStyle(): void {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
}
