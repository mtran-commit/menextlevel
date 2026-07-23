---
name: MeNotMe Arena Cache Busting
description: arena.png must carry a version query string in every CSS background-image reference or browsers serve stale versions showing the old illustrated left hand.
---

## Rule
Every time `arena.png` changes on disk, bump `?v=N` in ALL THREE CSS rules that reference it in `styles.css`:
1. `.stage { background-image: url(assets/arena.png?v=N) }`
2. `#rimFront { background-image: url(assets/arena.png?v=N) }`
3. `#netImg { background-image: url(assets/arena.png?v=N) }`

## Why
`styles.css` itself is loaded with `?v=N` (cache-busted via `<link>` tag in index.html), so the CSS file is always fresh. But within the CSS, `url(assets/arena.png)` without a version string is treated as a separate resource request — browsers cache it independently. After fixing arena.png on disk, users continue seeing the old illustrated left hand/rectangle because the browser never re-fetches the unchanged URL.

## How to apply
Whenever `arena.png` is regenerated or pixel-edited (ImageMagick FX, restore from git, etc.), also run:
```bash
sed -i 's/arena\.png?v=[0-9]*/arena.png?v=NEW/' artifacts/menotme/public/styles.css
```
Match the version with the rest of the static assets in index.html.

## History
- Version mismatch caused the "left hand and rectangle returned together" bug — the browser was serving a pre-FX arena.png despite the file on disk being correct.
- The FX region originally started at x=80, leaving pixels up to 228 RGB at x=0–79 (the hand extends to the image's left edge). Fixed by using `-region "750x494+0+530"` (x starts at 0).
- `?v=13` collided with an earlier session's cache of the same URL containing the old hand. Bumped to `?v=14`. Whenever arena.png changes, the version number must increase — never reuse a string that has previously pointed to an old copy.
