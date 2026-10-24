import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

export type Img = { width: number; height: number; data: Uint8Array };

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf: Uint8Array) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function chunk(type: string, body: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "ascii");
  out.set(body, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

export function encode(img: Img): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array()),
  ]);
}

// 8-bit, non-interlaced greyscale, RGB, indexed, grey+alpha and RGBA: enough for the library's PNGs.
export function decode(buf: Buffer): Img {
  let p = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  let plte: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), t = buf.toString("ascii", p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len);
    if (t === "IHDR") { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (t === "PLTE") plte = body;
    else if (t === "tRNS") trns = body;
    else if (t === "IDAT") idat.push(body);
    p += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`unsupported PNG: depth ${depth}, interlace ${interlace}`);
  const bpp = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      px[y * stride + x] = (v + pred) & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = px.subarray(i * bpp, i * bpp + bpp);
    const o = i * 4;
    if (type === 6) data.set(s, o);
    else if (type === 2) { data.set(s, o); data[o + 3] = 255; }
    else if (type === 0) { data[o] = data[o + 1] = data[o + 2] = s[0]; data[o + 3] = 255; }
    else if (type === 4) { data[o] = data[o + 1] = data[o + 2] = s[0]; data[o + 3] = s[1]; }
    else { data.set(plte!.subarray(s[0] * 3, s[0] * 3 + 3), o); data[o + 3] = trns && s[0] < trns.length ? trns[s[0]] : 255; }
  }
  return { width, height, data };
}

export const read = (path: string) => decode(readFileSync(path));

export function write(path: string, img: Img, scale = 8): void {
  writeFileSync(path, encode(img));
  if (scale > 1) writeFileSync(path.replace(/\.png$/, `.x${scale}.png`), encode(upscale(img, scale)));
}

export function upscale(img: Img, k: number): Img {
  const out = new Uint8Array(img.width * k * img.height * k * 4);
  for (let y = 0; y < img.height * k; y++)
    for (let x = 0; x < img.width * k; x++)
      out.set(img.data.subarray(((y / k | 0) * img.width + (x / k | 0)) * 4, ((y / k | 0) * img.width + (x / k | 0)) * 4 + 4), (y * img.width * k + x) * 4);
  return { width: img.width * k, height: img.height * k, data: out };
}

export const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const palette = (root: string, name: string): string[] => JSON.parse(readFileSync(`${root}/library/palettes/${name}.json`, "utf8")).colours;

// An indexed grid: one row string per line, one character per pixel; '.' is transparent.
export function fromGrid(rows: string[], key: Record<string, string>): Img {
  const height = rows.length, width = rows[0].length;
  const data = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`row ${y} is ${row.length} wide, expected ${width}`);
    [...row].forEach((ch, x) => {
      if (ch === ".") return;
      const c = key[ch];
      if (!c) throw new Error(`no colour for '${ch}' at ${x},${y}`);
      data.set([...hex(c), 255], (y * width + x) * 4);
    });
  });
  return { width, height, data };
}
