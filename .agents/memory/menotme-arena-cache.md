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
- Left arm reconstruction: x=0–750, y=530–1024 → `arena-clean-37eb9e66.png`
- Right hand + paper reconstruction: x=820–1260, y=540–920 → `arena-clean-432c25ea.png`
- Lower court-floor replacement (user-supplied reference image, 596×203): scaled to 1536×523, gamma-corrected (pow 1.25), composited at PNG y=418 with 130px gradient blend → `arena-clean-058a88fb.png` (current). Reference image placed so its court arc aligns with existing arena key lines; upper arena (y=0–418) is completely untouched.
- `hand-right.png` (Jul 22, unreferenced) deleted.
- Left fans crowd reconstruction (black void x=0–450, y=195–515 in PNG): generated dark crowd silhouettes via AI, multiplied to 15/255 mean brightness to match right-crowd reference (14/255), feathered right-edge blend 90px gradient, composited at y=195 → `arena-clean-b98650be.png` (current). Void was caused by a prior editing session darkening that region.

## Key lesson: fans-area void
Left fans zone (image x=0–450, y=230–500) had avg brightness 8–15/255 — a solid black rectangle baked into the PNG pixels, NOT a CSS overlay. Any future "black rectangle in fans area" report should verify PNG pixel values with ImageMagick before hunting for DOM elements.
