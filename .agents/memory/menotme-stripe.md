---
name: MeNotMe Stripe checkout
description: Stripe one-time payment checkout integration — architecture decisions, connector field names, build gotchas.
---

## Architecture

- Products live in our own `products` DB table (managed via Super Admin), NOT in Stripe's catalog.
- Checkout sessions use `price_data` (not Stripe price IDs) because we own the catalog.
- `stripeCheckoutSessionId` column on `orders` table (added via idempotent `ALTER TABLE` at startup in `index.ts`) — used for idempotent webhook lookup.
- `stripe.checkout_sessions` table (from stripe-replit-sync sync) is NOT used for business logic; we use our own `orders` table.

## Replit Stripe connector field names

The Replit connectors API returns `settings.secret` and `settings.publishable` — NOT `secret_key` / `publishable_key` (those are the template defaults but are WRONG for this connector).

```ts
// CORRECT for Replit Stripe connector:
secretKey:      settings.secret
publishableKey: settings.publishable
// No webhook_secret in settings — managed by stripe-replit-sync internally
```

## esbuild externalization — CRITICAL

`stripe-replit-sync` MUST be in the `external` list in `artifacts/api-server/build.mjs`. Without this, esbuild bundles the package and `__dirname` inside it resolves to the api-server `dist/` directory instead of the package's own directory. This causes `connectAndMigrate` to silently skip running migrations (migrations directory not found), leaving `stripe.*` tables uncreated.

**Why:** `runMigrations` resolves `path.resolve(__dirname, "./migrations")` at runtime. When bundled, `__dirname` is wrong.

**How to apply:** Any time `stripe-replit-sync` is referenced, confirm it's in the `external: [...]` array in `build.mjs`.

## StripeSync instance caching

`findOrCreateManagedWebhook()` configures the webhook secret on the SAME `StripeSync` instance. A fresh `new StripeSync(...)` created later will NOT have the webhook secret and `processWebhook()` will fail.

**Solution:** `initStripeSync()` in `stripeClient.ts` caches the instance after `findOrCreateManagedWebhook`. `getCachedStripeSync()` returns it. `webhookHandlers.ts` uses `getCachedStripeSync()` only.

## Webhook business logic pattern

Since we can't do a second `constructEvent()` (no standalone webhook secret in settings), the pattern is:
1. `sync.processWebhook(payload, sig)` — verifies signature, syncs Stripe data to `stripe.*` tables
2. If that succeeds: `JSON.parse(payload.toString())` to get event — safe because signature was already verified
3. Handle `checkout.session.completed` → update `orders` table (paymentStatus=paid, orderStatus=new, save customer + shipping details)

## Idempotency

Webhook handler checks `order.paymentStatus === 'paid'` before updating. No duplicate state changes on replayed events.

## Shipping

Currently free (`SHIPPING_AMOUNT_CENTS = 0`). Countries: `['AU']` only. Both are constants at the top of `routes/shop.ts` — easy to extend.

## Key routes

- `POST /api/shop/create-checkout-session` — public, creates order + Stripe session
- `GET /api/shop/order-success?session_id=cs_...` — public, returns order for success page
- `POST /api/stripe/webhook` — registered BEFORE `express.json()` in `app.ts`
