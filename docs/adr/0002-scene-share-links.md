# One page per Scene for Share links

A Share link must stay stable and preview well in chat apps, and GitHub Pages is a static host that cannot route paths. So every Scene is published at `scenes/<id>/` with a small generated `index.html` beside its `scene.json`: the stub carries the title and Poster as Open Graph tags and loads the shared Viewer. The Viewer is still one document that swaps Scenes with `history.pushState`, because sound permission in browsers lives on the document and would be lost by a full navigation.

## Considered options

- One `index.html` with `?scene=<id>`: no stubs to generate, but every Share link previews as the same generic page.
- `#<id>` on one page: same preview problem, and the hash never reaches the server.
- Routing by a GitHub Actions build: adds a build step for the same result as a stub written at staging time.
