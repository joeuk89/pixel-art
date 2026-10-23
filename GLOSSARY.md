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
