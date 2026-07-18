---
name: MeNotMe cloud layer
description: Durable rules for the auth/sync/notifications backend added around the locked prototype.
---

- **Rule:** All backend/auth/notification UI is an additive layer (`artifacts/menotme/src/cloud.ts` + `admin.html`/`src/admin.ts`); the game (`public/app.js`, game markup in index.html) stays byte-identical. Integration happens by wrapping the global `saveState()` (top-level function declarations are reassignable via `window`) and by writing to localStorage then calling `loadState()/render()`.
  **Why:** The prototype is locked by user mandate; wrapping globals avoids touching game code.
  **How to apply:** Any new feature must inject its own DOM/styles (b/w only) and never edit app.js.
- **Rule:** Clerk prebuilt UI (mountSignIn etc.) does not work here — the npm ESM bundle lacks UI components and remote-hosted-code loading fails behind the proxied preview. Use headless `clerk.client.signIn/signUp/attempt*` APIs with custom forms, importing from `@clerk/clerk-js/no-rhc`.
  **Why:** "Clerk was not loaded with Ui components" errors; burned an iteration on RHC.
- **Rule:** Server-side daily reset must mirror app.js exactly, including the 30-day gate: `finalBell()` is a no-op while the gate is incomplete, so the scheduler skips auto-finalize then and just rolls the day. Scheduler writes use compare-and-swap on `game_states.updatedAt` to avoid clobbering concurrent client saves, and wrap each user in try/catch (one bad state must not stall everyone).
- VAPID web-push keys are auto-generated at boot and persisted in the `app_config` DB table (avoids secret-handling; keys stay stable).
- Season rows are unique on (userId, startDate); duplicates existed once and were deduped — keep the unique index.
- **Rule:** Never stack monkey-patches on `window.saveState` — use the single `onGameSave()` hook registry in cloud.ts (one wrapper, a Set of removable listeners). Guest-mode listeners must be unhooked in `onSignedIn()`.
  **Why:** Stacked wrappers leaked guest signup prompts into the signed-in state (caught in review).
- Play-first flow decisions: the game is the landing page; no auth gate; onboarding overlay only for first-timers (flag `mnm_onboarded_v1` + progress/custom-tag heuristics so partially-onboarded guests aren't re-onboarded); signup prompted only at value moments; logout intentionally wipes the local copy (cloud restores on re-login) — testers may flag this as a "regression", it's by design.
