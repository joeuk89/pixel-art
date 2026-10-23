import { PALETTE as BASE } from "./palette.ts";

// Cosy Night 16 plus two greens for the plant and a neon pink for the sign (19 colours, under the 32 cap).
export const PALETTE = [...BASE, "#3d7a4a", "#8fcf6a", "#ff6fb5"];
export const PALETTE_NAME = "Cosy Night 16 + plant + neon";
export const SIZE = 64;

export type Prop = {
  id: string;
  // Subject-only brief for Pro Flash; undefined means the static Element already exists in out/raw/<id>-static.png.
  prompt?: string;
  // Motion brief for the animation services (describe movement, not appearance).
  motion: string;
  // Hand-briefed frame variants for the image-edit method; each becomes one extra frame, played ping-pong with the static.
  edits: string[];
  // Which code-driven motion the Viewer column uses.
  code: "blink" | "sway" | "tail" | "steam";
};

export const PROPS: Prop[] = [
  {
    id: "sign",
    prompt: "a small rectangular neon shop sign reading OPEN in glowing pink tube letters on a dark backing board with a thin frame, switched on, seen straight on",
    motion: "the neon tube letters flicker and blink on and off, the glow pulses gently",
    edits: ["the neon tube letters switched off, dark grey unlit tubes, everything else unchanged", "the neon letters glowing dimmer, about half brightness, everything else unchanged"],
    code: "blink",
  },
  {
    id: "plant",
    prompt: "a small leafy potted plant with a few broad green leaves on thin stems in a terracotta pot, seen from the side",
    motion: "the leaves sway gently side to side in a soft breeze, the pot stays still",
    edits: ["the leaves leaning slightly to the left as if in a light breeze, pot unchanged", "the leaves leaning slightly to the right as if in a light breeze, pot unchanged"],
    code: "sway",
  },
  {
    id: "cat",
    motion: "the sleeping cat breathes slowly and the tip of its tail twitches now and then",
    edits: ["the tip of the tail lifted slightly upward, everything else unchanged", "the tip of the tail curled a little tighter inward, everything else unchanged"],
    code: "tail",
  },
  {
    id: "mug",
    prompt: "a plain ceramic mug of hot coffee with a handle, seen from the side, no steam",
    motion: "thin wisps of steam rise and drift from the hot coffee, the mug stays still",
    edits: ["two thin wisps of steam rising above the mug, mug unchanged", "one tall thin curl of steam drifting up and to the right, mug unchanged"],
    code: "steam",
  },
];
