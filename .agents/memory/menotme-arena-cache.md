---
name: MeNotMe Arena Cache Busting
description: arena PNG changes must use a new content-hash filename in all three CSS rules; both old hands were baked into the arena PNG, not separate DOM elements.
---

## Rule
The arena PNG uses **content-hash filenames** (e.g. `arena-clean-432c25ea.png`) — not query-string versioning. Every time the PNG changes, a new hash name is generated and ALL THREE CSS rules in `styles.css` must be updated:
1. `.stage { background-image: url(assets/arena-clean-HASH.png) }`
2. `#rimFront { background-image: url(assets/arena-clean-HASH.png) }`
3. `#netImg { background-image: url(assets/arena-clean-HASH.png) }`

Use: `sed -i 's/arena-clean-OLD\.png/arena-clean-NEW.png/g' artifacts/menotme/public/styles.css`  
And do the same in `artifacts/menotme/dist/public/styles.css`, then copy the new PNG to both `public/assets/` and `dist/public/assets/`.

## Critical finding: both "legacy hands" were baked into the arena PNG
When the user reported THREE visible hands (left arm, right hand + paper, new overlay hand), the root cause was:
- The arena background PNG itself had photorealistic hand/arm artwork baked in as part of the original illustration (NOT separate DOM/CSS elements)
- The new `#handWrap` overlay (added later) created an additional visible hand on top of the baked ones
- Searching HTML/JS/CSS found NO separate hand DOM elements beyond `#handWrap`

## Reconstruction technique (for right-hand zone)
The baked right hand occupied PNG x=820–1260, y=540–920.
Two-zone treatment:
1. **Arc zone y=540–600**: blur+darken (×0.05) then restore pixels originally >75% as court lines
2. **Hand zone y=600–920**: tile clean floor strip from y=935–990 (same x range, vertically flipped alternating strips for texture variation) + mild blur + Gaussian noise
3. After tiling: one targeted darkening pass (×0.03) on any tiling artifact bright spots
4. Court arc lines at y≈580 (originally 255 brightness) must be verified after each pass

## Why
Browser caches arena PNG independently from styles.css. Hash-based filename ensures a changed PNG is always fetched fresh.

## History
- Left arm reconstruction (session prior): x=0–750, y=530–1024 → `arena-clean-37eb9e66.png`
- Right hand + paper reconstruction (this session): x=820–1260, y=540–920 → `arena-clean-432c25ea.png`
- `hand-right.png` (Jul 22, unreferenced) and `arena-clean-37eb9e66.png` deleted after upgrade.
