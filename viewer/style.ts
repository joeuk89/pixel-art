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
.missing { padding: 24px 16px; }
`;

export function injectStyle(): void {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
}
