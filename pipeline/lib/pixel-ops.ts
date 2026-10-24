export type Pixels = { width: number; height: number; data: Uint8Array };
export type Rect = { x: number; y: number; width: number; height: number };

type Lab = [number, number, number];

const TRANSPARENT = -1;

function key(p: Pixels, x: number, y: number): number {
  const i = (y * p.width + x) * 4;
  return p.data[i + 3] === 0 ? TRANSPARENT : (p.data[i] << 16) | (p.data[i + 1] << 8) | p.data[i + 2];
}

export function paletteSet(palette: string[]): Set<number> {
  return new Set(palette.map((hex) => parseInt(hex.slice(1), 16)));
}

export function opaqueBox(p: Pixels): Rect {
  let minX = p.width, minY = p.height, maxX = -1, maxY = -1;
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      if (p.data[(y * p.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? { x: 0, y: 0, width: 0, height: 0 } : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function crop(p: Pixels, x: number, y: number, width: number, height: number): Pixels {
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * p.width + x) * 4;
    data.set(p.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data };
}

export function trim(p: Pixels): Pixels {
  const box = opaqueBox(p);
  return crop(p, box.x, box.y, box.width, box.height);
}

export function flipX(p: Pixels): Pixels {
  const data = new Uint8Array(p.data.length);
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const from = (y * p.width + x) * 4;
      data.set(p.data.subarray(from, from + 4), (y * p.width + p.width - 1 - x) * 4);
    }
  }
  return { width: p.width, height: p.height, data };
}

export function binaryAlpha(p: Pixels): Pixels {
  const data = new Uint8Array(p.data);
  for (let i = 3; i < data.length; i += 4) data[i] = data[i] < 128 ? 0 : 255;
  return { width: p.width, height: p.height, data };
}

export function softAlphaCount(p: Pixels): number {
  let n = 0;
  for (let i = 3; i < p.data.length; i += 4) if (p.data[i] !== 0 && p.data[i] !== 255) n++;
  return n;
}

export function transparentCount(p: Pixels): number {
  let n = 0;
  for (let i = 3; i < p.data.length; i += 4) if (p.data[i] === 0) n++;
  return n;
}

export function offPaletteCount(p: Pixels, palette: string[]): number {
  const colours = paletteSet(palette);
  let n = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    if (p.data[i + 3] !== 0 && !colours.has((p.data[i] << 16) | (p.data[i + 1] << 8) | p.data[i + 2])) n++;
  }
  return n;
}

const linear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

function oklab(r: number, g: number, b: number): Lab {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const rgbOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255] as const;
};

export type Snapped = { frame: Pixels; opaque: number; offPalette: number };

export function snapToPalette(frame: Pixels, palette: string[]): Snapped {
  const colours = palette.map(rgbOf);
  const labs = colours.map(([r, g, b]) => oklab(r, g, b));
  const exact = paletteSet(palette);
  const nearest = new Map<number, readonly [number, number, number]>();
  const data = new Uint8Array(frame.data);
  let opaque = 0, offPalette = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    opaque++;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    if (exact.has(key)) continue;
    offPalette++;
    let hit = nearest.get(key);
    if (!hit) {
      const [l, a, b] = oklab(data[i], data[i + 1], data[i + 2]);
      let best = 0, bestDistance = Infinity;
      labs.forEach(([pl, pa, pb], k) => {
        const d = (l - pl) ** 2 + (a - pa) ** 2 + (b - pb) ** 2;
        if (d < bestDistance) { bestDistance = d; best = k; }
      });
      hit = colours[best];
      nearest.set(key, hit);
    }
    data.set(hit, i);
  }
  return { frame: { width: frame.width, height: frame.height, data }, opaque, offPalette };
}

export function orphans(p: Pixels): { count: number; share: number } {
  let count = 0, opaque = 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= p.width || y >= p.height ? TRANSPARENT : key(p, x, y));
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const c = key(p, x, y);
      if (c === TRANSPARENT) continue;
      opaque++;
      if (at(x - 1, y) !== c && at(x + 1, y) !== c && at(x, y - 1) !== c && at(x, y + 1) !== c) count++;
    }
  }
  return { count, share: opaque === 0 ? 0 : count / opaque };
}

export function checkerboards(p: Pixels): number {
  let n = 0;
  for (let y = 0; y + 1 < p.height; y++) {
    for (let x = 0; x + 1 < p.width; x++) {
      const a = key(p, x, y), b = key(p, x + 1, y);
      if (a === TRANSPARENT || b === TRANSPARENT || a === b) continue;
      if (key(p, x, y + 1) === b && key(p, x + 1, y + 1) === a) n++;
    }
  }
  return n;
}

export function wrapSeamMismatch(p: Pixels): number {
  let n = 0;
  for (let y = 0; y < p.height; y++) if (key(p, 0, y) !== key(p, p.width - 1, y)) n++;
  return n;
}

export function islands(p: Pixels): number {
  const { width, height } = p;
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  let count = 0;
  for (let start = 0; start < width * height; start++) {
    if (p.data[start * 4 + 3] === 0 || seen[start]) continue;
    count++;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const q = stack.pop()!;
      const x = q % width, y = (q - x) / width;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const r = ny * width + nx;
        if (p.data[r * 4 + 3] !== 0 && !seen[r]) { seen[r] = 1; stack.push(r); }
      }
    }
  }
  return count;
}
