---
name: MeNotMe mobile visual rules
description: Mobile-specific rendering gotchas for the MeNotMe arena confirmed across 320–768px.
---
## Court-pulse white rectangle (root cause & fix)
- **Root cause:** `.court-pulse` elements are inside `@supports (mask-image: url(""))`. That check passes on all mobile browsers, but on mobile WebKit (iOS Safari / Chrome) the CSS `mask-image` at `179.44%` scale fails to clip the white `linear-gradient`. The raw gradient leaks as a solid white rectangle within the `clip-path` boundary.
- **Fix:** On mobile, remove the PNG mask entirely (`mask-image:none; -webkit-mask-image:none`) and apply `mix-blend-mode:overlay` instead. Overlay maths: floor (luminance≈0.05) → stays near-black; court lines (luminance≈0.9) → stays near-white. The gradient is confined to bright areas without any mask image, eliminating scaling/alignment issues.
- **Why NOT `filter:none` alone:** The drop-shadow removal reduces bloom but does not stop the gradient from showing — the mask failure is the source.
- **Why NOT `display:none` on `.pb`:** The spec requires travelling illumination on the key/lane area on mobile.

## Court-pulse .pa (broad floor sweep)
- **Rule:** `.court-pulse.pa` must also be `display:none` on mobile.
- **Why:** `.pa` uses `clip-path:inset(36% 0 43.5% 0)` — zero left/right inset = full width. Even with `mix-blend-mode:overlay`, the broad gradient over faded/lighter floor areas still creates unwanted brightening. Hiding `.pa` keeps only the tighter `.pb` (key/paint area).

## White circle in center of court
- **Rule:** `.shootbtn .ball` must be `display:none` on mobile.
- **Why:** On desktop the paper is at `left:65%` (close to the ball at `left:50%`). On mobile the paper moves to `left:77%` while the ball stays at `left:50%`, creating a second phantom white circle mid-court. The `#paper` element is the real interactive ball.

## Paper ::before glow
- **Rule:** Reduce the `::before` box-shadow on mobile vs desktop.
- **Why:** The paper is larger on mobile (16.59% vs 9.24% width). Full desktop glow becomes too prominent. Mobile values: `0 0 6px / 12px / inset 6px` with reduced alpha.

## Desktop
- All fixes are in `@media (max-width:680px)` only. Desktop `.court-pulse` (both `.pa` and `.pb`), `.shootbtn .ball`, and `.paper::before` are unchanged.
