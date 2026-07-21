---
name: MeNotMe mobile visual rules
description: Mobile-specific rendering gotchas for the MeNotMe arena confirmed across 320–768px.
---
## Court reflection (white floor sweep)
- **Rule:** `.court-pulse.pa` must be `display:none` on mobile (`@media (max-width:680px)`).
- **Why:** `.pa` uses `clip-path:inset(36% 0 43.5% 0)` — zero left/right inset = full width. On mobile the arena is centre-cropped at 179% scale. Mobile Safari does not reliably honour `-webkit-mask-image` at that scale, so the raw white gradient sweeps the entire court floor. Hiding `.pa` removes the sweep while keeping `.pb` (key/paint area, tight insets) for the neon line feel.
- `filter:drop-shadow` removal alone (`filter:none`) is not sufficient — the raw gradient itself bleeds through the misaligned mask.

## White circle in center of court
- **Rule:** `.shootbtn .ball` must be `display:none` on mobile.
- **Why:** The `.ball` span inside the SHOOT button uses `margin-top:-34%` to float a white sphere above the action bar. On desktop the paper is at `left:65%` (close to the ball at `left:50%`), so they read as one unit. On mobile the paper moves to `left:77%` while the ball stays at `left:50%`, creating a second phantom white circle in the middle of the court. The `#paper` element is the real interactive ball.

## Paper ::before glow
- **Rule:** Reduce the `::before` box-shadow on mobile vs desktop.
- **Why:** The paper is larger on mobile (16.59% vs 9.24% width). The full desktop glow (`0 0 10px / 22px / inset 10px`) becomes too prominent and contributes to the "solid white circle" impression. Mobile values: `0 0 6px / 12px / inset 6px` with reduced alpha.

## Desktop
- All three fixes are in `@media (max-width:680px)` only. Desktop `.court-pulse.pa`, `.shootbtn .ball`, and `.paper::before` are unchanged.
