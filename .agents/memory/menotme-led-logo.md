---
name: MeNotMe LED Logo
description: Interactive LED dot-matrix logo implementation for Me Next Level — where it lives, how it works, and constraints.
---

## What it is
`artifacts/menotme/public/led-logo.js` — IIFE that exposes `window.LEDLogo = { init(canvas) }`.

Renders "ME NEXT LEVEL" as 69-column × 7-row LED dot grid on a `<canvas>`:
- ME and LEVEL → white LEDs
- NEXT → red LEDs (sinusoidal pulse + brightens in sweep)
- Travelling sweep band moves L→R (~2.3 s cycle)
- Click/touch ripple from tap point
- Hover burst from centre
- `prefers-reduced-motion`: static fully-lit state, no animation

## Grid layout (69 columns)
ME(5+1+5=11) + space(3) + NEXT(5+1+5+1+5+1+5=23) + space(3) + LEVEL(5+1+5+1+5+1+5+1+5=29) = 69 cols, 7 rows

## Where it's used
1. **Main arena header** — `index.html` `.brand` div: `<canvas id="ledLogo" class="led-logo" aria-label="Me Next Level" role="img">`, initialized by inline script after `led-logo.js`
2. **Auth overlay** — `cloud.ts` `renderAuth()`: canvas element created programmatically, `window.LEDLogo.init(ledCanvas)` called inline

## CSS rules
`.brand .led-logo { display:block; width:100%; max-width:380px; margin:0 auto; }` (desktop cap)
Mobile (≤680px): `.brand .led-logo { max-width:100% }` (removes cap, fills brand div)
Height is set by JS via `setSize()` (aspect ratio NROWS/NCOLS = 7/69).

## Known constraint
The tutorial/onboarding overlay (`position:fixed; z-index:120; background:rgba(0,0,0,.88)`) covers the header on first load, so the LED logo is not visible until the tutorial is dismissed. This is expected — the logo runs beneath the overlay and appears immediately on dismiss.

**Why:** The tutorial uses `mnm_onboarded_v1` localStorage key to gate display. Fresh sessions always show tutorial first.

## Verified behaviour
Tested at 500px / 320px / 200px widths via standalone test page — all sizes render cleanly with correct colours, dot grid, and sweep animation visible.
