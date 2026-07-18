# MeNotMe

A black-and-white premium neon basketball habit game: complete Assets to shoot for Team Me, address Liabilities daily, and beat Team Not Me at the Final Bell. Slogan: "Play for the person you want to become."

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/menotme/index.html` — app markup (served at `/`)
- `artifacts/menotme/public/styles.css` — all styles
- `artifacts/menotme/public/app.js` — all game logic (localStorage persistence, key `menotme_complete_v1`)
- `artifacts/menotme/public/assets/mockup.png` — the premium neon court mockup image (extracted from the original embedded base64)
- `attached_assets/menotme_complete_premium_working_1784338039029.html` — the LOCKED original prototype (source of truth)

## Architecture decisions

- The uploaded prototype HTML is the locked source of truth. It was split byte-for-byte into index.html / styles.css / app.js / assets with no visual or behavioral changes.
- Plain HTML/CSS/JS, no framework — per the user's explicit instruction not to introduce one. The React scaffold files under `artifacts/menotme/src/` are unused (index.html does not load them).
- Persistence stays in localStorage for now; no auth/database/cloud sync until the user approves moving past Stage 1–2 parity.

## Product

- The game itself (locked prototype UI): daily Assets/Liabilities, shots for Team Me, Final Bell, streaks, ceremonies at 7/30/60/90 days, 90-day seasons.
- Play-first landing: the game itself IS the homepage. No auth gate — new visitors get a 3-step onboarding overlay over the live game (Team Me vs Team Not Me intro → 3 custom Assets → 3 custom Liabilities, replacing the defaults) then a guided first shot with highlights and a celebration card. Guests play fully locally (Guest Mode); returning visitors never see onboarding again (`mnm_onboarded_v1` flag + progress/custom-tag heuristics).
- Signup prompts only at value moments: first daily win, 3 days of history, or tapping the guest ☺ fab. Auth overlay is always dismissible ("CONTINUE AS GUEST").
- Accounts (Clerk, headless): Continue with Google (OAuth redirect + `handleRedirectCallback`) or email+password with email-code verification and password reset — custom black/white forms in `src/cloud.ts`. On first sign-in, guest progress migrates idempotently; logout intentionally clears the local copy (cloud remains source of truth; restored on next sign-in).
- Onboarding funnel analytics: whitelisted events → `POST /api/analytics/events` (public, rate-limited 30/min per anonId+IP, 3000/min global) → `analytics_events` table.
- Cloud sync: localStorage stays the runtime store; every `saveState()` is debounced to `PUT /api/game/state`. First login idempotently imports local progress (`POST /api/game/migrate`); afterwards cloud is source of truth.
- In-app notification center (bell) + optional browser web-push (VAPID keys auto-generated, stored in `app_config` table). Per-type in-app/push toggles in the account panel.
- Retention reminders + timezone-aware daily resets run in a 5-min scheduler inside the API server (`lib/game.ts`): auto Final Bell at local midnight (mirrors app.js incl. the 30-day gate block), reminders (final bell approaching, liabilities ignored, Not Me winning, one-more-asset, streak at risk, 7-day milestone).
- Account management: profile (display name, signature), change password, log out, permanent delete (cascades all data + Clerk user).
- Super-admin panel at `/admin.html`: user search/suspend/reactivate/delete, DAU/WAU/streak/tag stats, reports, announcements (fan out as notifications), achievement rules, audit/error logs. First user can claim admin via `POST /api/admin/claim` while no admin exists.

## User preferences

- Do NOT redesign, restyle, simplify, or reinterpret the MeNotMe interface. It must remain black and white exactly as the uploaded prototype.
- Do not rename MeNotMe or change the slogan "Play for the person you want to become."
- Do not make unsolicited improvements — ask for approval before any visual or functional modification.
- Auth/database/cloud sync were approved and added later — but only as an *additive* layer (`src/cloud.ts`, styled black/white); `public/app.js` and the game markup remain untouched.

## Gotchas

- Clerk's npm ESM bundle has no prebuilt UI components (they're remote-hosted and blocked behind the preview proxy) — use the headless client API (`clerk.client.signIn/signUp`) with custom forms; import from `@clerk/clerk-js/no-rhc`.
- `#gate` element is always in the DOM; it's shown/hidden via `.gate.show` CSS — check visibility, not presence.
- After changing `lib/db` schema: `pnpm --filter @workspace/db run push`, and rebuild declarations (`npx tsc -b lib/db`) or api-server typecheck sees stale types.
- Vite build for menotme needs `PORT` and `BASE_PATH` env vars set (deployment sets them).
- Clerk dev-instance test emails: `*+clerk_test@...`, verification code 424242 (used by e2e testers; programmatic claim-override login also works).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
