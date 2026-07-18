---
name: MeNotMe inspiration engine
description: Design rules and gotchas for the Contextual Inspiration Engine (narrated quote system)
---
- Quotes are 64 pregenerated announcer clips (`insp_q01`–`insp_q64`, ElevenLabs Daryl voice) — never runtime TTS. Triggers are deterministic game-state rules in `inspire.js`; no AI decides when to speak.
- **Why key gotchas exist:**
  - `state` in app.js is a top-level `let`, so `window.state` is undefined. Any add-on script must reference bare `state` with a `typeof state==="undefined"` guard, never `window.state`.
  - Audio "is narration playing" checks must be time-based (clip duration guard), not `onended`-based — a suspended AudioContext never fires `onended` and a boolean flag gets stuck, silently blocking queued quotes.
  - Any probabilistic fallback branch (e.g. crowd shout instead of narrated quote) must still record itself in `mnm_inspire_v1.fired` — otherwise it is indistinguishable from a silent failure in tests.
- **How to apply:** engine memory lives in localStorage `mnm_inspire_v1` (daily cap 3 narrated quotes, milestones exempt; 10-min cooldown; last-10 no-repeat). Cap/cooldown only count quotes that actually narrated (text-only mode is uncapped by design). insp_* clips are lazy-fetched (5MB total) — keep it that way.
- E2E note: testers must check `classList.contains('show')` on `#inspireQuote`, not the element's `.show` property, and restore any stubbed `Math.random` (the engine uses it for chance gates).
