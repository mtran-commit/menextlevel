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

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- Do NOT redesign, restyle, simplify, or reinterpret the MeNotMe interface. It must remain black and white exactly as the uploaded prototype.
- Do not rename MeNotMe or change the slogan "Play for the person you want to become."
- Do not make unsolicited improvements — ask for approval before any visual or functional modification.
- No authentication, databases, or cloud syncing until the user approves (localStorage only for now).

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
