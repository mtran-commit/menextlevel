---
name: MeNotMe locked prototype
description: The MeNotMe app is a preserved prototype — never redesign it; original HTML in attached_assets is the source of truth.
---

The user uploaded a finished interactive prototype (`attached_assets/menotme_complete_premium_working_*.html`) and declared it the LOCKED source of truth for design, layout, wording, mechanics, and UX.

**Rule:** Never redesign, restyle, add color, or "improve" the MeNotMe UI. It must stay black-and-white and visually identical to the original. Ask before any visual or functional change.

**Why:** Explicit, emphatic user instruction — "When uncertain, preserve the original code rather than changing it. Do not make unsolicited improvements."

**How to apply:** Any change to `artifacts/menotme` must preserve exact visual/behavioral parity with the original file. The app was split verbatim into `index.html` + `public/styles.css` + `public/app.js` + `public/assets/mockup.png` (base64 mockup extracted to PNG). Persistence is localStorage (`menotme_complete_v1`); no backend/auth until the user approves.
