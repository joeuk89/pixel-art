import type { Wav } from "../../../pipeline/lib/audio.ts";

// A slow chord with a swelling envelope: steady enough to loop, never silent at a cut.
export function synthMusic(seconds: number, rate: number): Wav {
  const n = Math.round(seconds * rate);
  const left = new Float32Array(n), right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const swell = 0.6 + 0.25 * Math.sin((2 * Math.PI * t) / 7.3) + 0.15 * Math.sin((2 * Math.PI * t) / 23.1);
    const chord = Math.sin(2 * Math.PI * 110 * t) + 0.6 * Math.sin(2 * Math.PI * 164.8 * t) + 0.4 * Math.sin(2 * Math.PI * 220.5 * t + 1);
    left[i] = 0.25 * swell * chord;
    right[i] = 0.25 * swell * (chord + 0.3 * Math.sin(2 * Math.PI * 330 * t));
  }
  return { rate, ch: 2, data: [left, right] };
}
