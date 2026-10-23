# Named house palettes, and regenerate instead of re-palettise

Elements only fit together when they share a Palette, so a Scene does not own a fresh Palette: it names one from `library/palettes/`, and Elements are generated locked to that Palette and reused only under it. A Palette is never edited once an Element is locked to it (add a new named Palette instead), because editing would make every Element locked to it drift. An Element that does not fit a Scene's Palette is regenerated (about $0.03) rather than converted with a quantiser: the element-fidelity prototype showed the image service honours the palette lock exactly and returns clean alpha, while any conversion step can only add halo and mismatch.

## Considered options

- One Palette per Scene with a quantiser to re-palettise reused Elements: maximal colour freedom, but reuse becomes rare and the TypeScript quantiser path (grid detection, Oklab nearest-colour) sits on the main path for every Scene.
- Editable Palettes: convenient, but silently changes already-published Scenes.
