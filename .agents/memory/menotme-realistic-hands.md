---
name: MeNotMe Realistic Hands
description: How the photorealistic hand assets are implemented — where they live, how they cover the baked artwork, and how they animate.
---

## What was done
The original illustrated/baked hands in `arena.png` were replaced with photorealistic AI-generated hand images. The baked art cannot be edited, so the approach uses:
1. Dark overlay masks to suppress the baked illustrated hands
2. Transparent-background PNG hand images layered on top

## Assets
- `public/assets/hand-left.png` — open palm, first-person view, entering from bottom-left, dark cuff, neon rim lighting
- `public/assets/hand-right.png` — gripping crumpled paper ball, first-person view, entering from right, dark cuff, neon rim lighting

Both generated with `removeBackground: true` (transparent PNG).

## DOM structure (inside `.stage`, before `#paper`)
```
.hand-mask.hand-mask-left   z-index:2  (suppresses baked left hand)
.hand-mask.hand-mask-right  z-index:2  (suppresses baked right hand)
img.hand.hand-left#handLeft z-index:3
img.hand.hand-right#handRight z-index:3
.live.paper#paper           z-index:10  (sits above hands)
```

## CSS key values (check styles.css for actuals)
- Masks: `rgba(0,0,0,.88)` fill, positioned to cover baked artwork area in lower stage
- Left hand: `left:-4%; bottom:-24%; width:46%` (image right-portion is the hand)
- Right hand: `right:7%; bottom:-24%; width:48%` (image upper-left is the gripping hand/paper)
- `transform-origin` set for natural wrist pivot during drag animations
- `overflow:hidden` on `.stage` naturally clips wrists below stage bottom edge

## JS animations (app.js pointer handlers)
- `pointerdown`: disable transition, remove any throw class
- `pointermove`: translate hands 7-9% of paper drag delta (subtle follow)
- `pointerup`: reset position, force-reflow, add `.throw` class for follow-through animation, remove after 580ms

## Why this approach
`arena.png` is a single background image that cannot be edited without regenerating the entire arena artwork. Adding separate hand elements as an overlay layer is the only way to replace the hands without touching arena.png.

**How to apply:** If hands need updating (different skin tone, different pose), regenerate the two PNG assets and drop them into the same paths — no HTML/CSS/JS changes needed.
