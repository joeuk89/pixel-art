# Pixel Art Scenes

A personal web app that generates cosy, animated pixel-art scenes with matching sound, to be left open in a browser tab.

## Language

**Scene**:
One generated bundle: the artwork, its animation, its Soundtrack and the Prompt that made it.
_Avoid_: Wallpaper, image, video, artwork (for the whole bundle)

**Prompt**:
The text typed to request a new Scene.
_Avoid_: Request, description, query

**Viewer**:
The browser page that plays one Scene, including fullscreen.
_Avoid_: Player, app, canvas (for the page)

**Soundtrack**:
The music and ambient sound of one Scene.
_Avoid_: Audio, music (when ambient sound is included), track

**Share link**:
The public permalink that plays one Scene for anyone, with no login.
_Avoid_: Share, export, embed

**Element**:
One generated, reusable visual piece of a Scene, such as a lamp or a skyline, kept in the Element library.
_Avoid_: Asset, sprite, object, part

**Element library**:
The tagged collection of Elements that new Scenes shop from before anything is generated.
_Avoid_: Asset store, sprite sheet, catalogue

**Gallery**:
The Viewer's list of generated Scenes.
_Avoid_: Library (for Scenes), feed, index

**Director**:
The Claude Code skill that turns a Prompt into a Scene plan and drives the pipeline that produces the Scene.
_Avoid_: Generator, orchestrator, agent

**Scene plan**:
The structured description of a Scene the Director writes before any Element or Soundtrack is generated.
_Avoid_: Manifest, config, spec, scene file

**Layer**:
One draw-ordered slice of a Scene; a Scene is drawn layer by layer, first to last.
_Avoid_: Depth, plane, z-index

**Placement**:
One Element put at a position in a Layer.
_Avoid_: Instance, sprite, object

**Primitive**:
One code-driven animation effect the Viewer runs on a Scene, such as rain, lamp glow, steam or twinkle.
_Avoid_: Effect, animation, shader

**Poster**:
The still image that stands in for a Scene in the Gallery and in Share link previews.
_Avoid_: Thumbnail, screenshot, cover

**Palette**:
The named, ordered set of colours a Scene and its Elements are locked to.
_Avoid_: Colour scheme, theme, swatch

**Element record**:
The metadata kept beside an Element: what it is, how it was made and which Palette it is locked to.
_Avoid_: Sidecar, metadata file, manifest

**Ambient loop**:
One seamless looping ambient sound in the Sound library, with its licence recorded.
_Avoid_: Sample, sound file, clip

**Sound library**:
The collection of Ambient loops the Director shops from for a Soundtrack.
_Avoid_: Sound bank, sample pack

**Attempt**:
One generation call for one Element or Frame strip, judged by the Quality gate; an Element may take several Attempts.
_Avoid_: Try, run, call, generation (for the judged unit)

**Frame strip**:
The row of frames that animates one Element, kept beside its still in the Element library; frame 0 is the still itself.
_Avoid_: Sprite sheet, animation, GIF, strip (alone)

**Quality gate**:
The checks every Attempt must pass before its Element enters the Element library: programmatic checks first, then the Director's visual check.
_Avoid_: Validation, QA, review (for the whole gate)

**Style anchor**:
The first Element generated for a Scene, passed as the style image to every later Attempt in that Scene so they read as one hand.
_Avoid_: Reference image, style image (for the Element itself), seed image

**Distance**:
How close an ambient sound sits to the viewer: near, mid or far. Sets how loud and how muffled it plays.
_Avoid_: Layer (for sound), tier, bus, plane

**One-shot**:
A single ambient sound event, such as thunder or an owl, that a Scene fires now and then instead of looping.
_Avoid_: Trigger, event, sample, stinger
