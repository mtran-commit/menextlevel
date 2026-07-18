---
name: MeNotMe locked prototype
description: The MeNotMe app is a preserved prototype — never redesign it; original HTML in attached_assets is the source of truth.
---

The user uploaded a finished interactive prototype (`attached_assets/menotme_complete_premium_working_*.html`) and declared it the LOCKED source of truth for design, layout, wording, mechanics, and UX.

**Rule:** Never redesign, restyle, add color, or "improve" the MeNotMe UI. It must stay black-and-white and visually identical to the original. Ask before any visual or functional change.

**Why:** Explicit, emphatic user instruction — "When uncertain, preserve the original code rather than changing it. Do not make unsolicited improvements."

**How to apply:** Any change to `artifacts/menotme` must preserve exact visual/behavioral parity with the original file. The app was split verbatim into `index.html` + `public/styles.css` + `public/app.js` + `public/assets/mockup.png` (base64 mockup extracted to PNG). Persistence is localStorage (`menotme_complete_v1`); no backend/auth until the user approves.

SUPERSEDED (July 18, 2026): the user uploaded a NEW locked landscape arena mockup (`public/assets/arena.png`, 1536×1024) and an exhaustive spec; the old portrait mockup was retired and the main screen rebuilt to match it (real HTML header/scoreboard/panels/action bar/nav over an image-window arena stage). The new mockup is now the locked visual source of truth. Pre-rebuild files are archived at `artifacts/menotme/backups/pre-arena-2026-07-18/`.

Durable techniques for this app:
- Arena stage shows a source-pixel window of arena.png via background-size/position; desktop window x 0–1536 / y 232–898, mobile (≤680px) x 340–1196. Any pixel-anchored overlay has per-breakpoint CSS coords.
- Hoop occlusion/net animation uses invisible "pixel-copy" divs (`#rimFront` z11, `#netWrap`/`#netImg` z9) whose backgrounds re-show the exact art region; shot trajectory reads their live rects, so it stays responsive.
- Court-line pulse = travelling gradient luminance-masked by the arena art itself, clipped to court regions (two divs to dodge the hands' luminance).
- `saveState`/`loadState`/`render` signatures and ids `#paper #shoot #assets` must stay — cloud.ts hooks them. Fan photos stored as ≤96px JPEG thumbs, 300KB total budget; saveState drops photos on quota errors.
- Doubter names are private: never rendered on signs; right-side signs use fixed motivational text.
- New-day intro (intro.js) runs once per day via localStorage `mnm_intro_day`; commentator lines are pregenerated fixed clips (comm_*.mp3, Daryl announcer voice) picked by game state at runtime — NO runtime TTS in the shipped app and never any user-entered names spoken; whole sequence hard-capped under 8s with a Skip button.
- Arena Sponsors (July 2026): LED boards are an additive `#sponsorLayer` at z3 (below signs z4/live z5/panels z6/paper z10) fed by `GET /api/sponsors/active`; falls back to untracked MENOTME house ads when API is down or no campaigns. Rotation pauses during the ~1.9s shot window; clicks require a deliberate tap (<700ms, <8px). Delivery/targeting/events use ONLY device + guest/registered (+optional country) — never assets/liabilities/fans/doubters. Admin CRUD lives in admin.html "SPONSOR CAMPAIGNS" tab → /api/admin/sponsors.
- Crowd audio (July 2026): 30 generated mp3s in `public/assets/audio/` (ElevenLabs TTS voices + SFX + beat loop, commercial-use OK; no browser TTS). `crowd-audio.js` hooks gameplay by REBINDING app.js globals `tone/cheer/missSound/boo` (late binding, load order app.js → arena.js → crowd-audio.js — keep that order). Fans panned left, doubters right; single-voice lock + cooldowns; prefs in `state.audio` (master/crowd/fanVoices/doubterVoices/music, music defaults off). Doubter names never spoken.
