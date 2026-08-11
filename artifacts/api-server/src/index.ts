import app from "./app";
import { logger } from "./lib/logger";
import { runDailyResets, runReminders } from "./lib/game";
import { getVapidKeys } from "./lib/notify";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ---------------------------------------------------------------------------
// Stripe initialization — non-blocking; server starts regardless of outcome.
// Requires the Stripe integration to be connected via the Integrations tab.
// ---------------------------------------------------------------------------
async function initStripe() {
  try {
    const { runMigrations } = await import("stripe-replit-sync");
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL required");

    // 1. Create stripe.* schema tables (idempotent)
    await runMigrations({ databaseUrl, schema: 'stripe' });
    logger.info("Stripe schema ready");

    // 2. Create the StripeSync instance, register managed webhook, and cache it.
    //    The cached instance retains the webhook secret for processWebhook() calls.
    const { initStripeSync } = await import("./lib/stripeClient");
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    if (!domain) {
      logger.warn("REPLIT_DOMAINS not set — skipping webhook registration");
      return;
    }

    const webhookUrl = `https://${domain}/api/stripe/webhook`;
    const stripeSync = await initStripeSync(databaseUrl, webhookUrl);
    logger.info({ webhookUrl }, "Stripe webhook configured");

    // 3. Sync existing Stripe data in the background (non-blocking)
    stripeSync.syncBackfill()
      .then(() => logger.info("Stripe data synced"))
      .catch((err) => logger.warn({ err }, "Stripe syncBackfill failed"));
  } catch (err) {
    logger.warn(
      { err },
      "Stripe initialization failed — payment features unavailable until Stripe integration is connected",
    );
  }
}

async function main() {
  // ---------------------------------------------------------------------------
  // Idempotent DML backfill — safe to re-run on every startup.
  // Populates normalized_name for any rows that existed before the column was
  // added.
  // ---------------------------------------------------------------------------
  try {
    const normExpr = sql.raw(`
      lower(trim(regexp_replace(
        regexp_replace(trim(name), '\\s+', ' ', 'g'),
        '[^[:alnum:]_[:space:]]', '', 'g'
      )))
    `);

    const { rowCount: assetRows } = await db.execute(sql`
      UPDATE assets SET normalized_name = ${normExpr} WHERE normalized_name IS NULL
    `);
    const { rowCount: liabRows } = await db.execute(sql`
      UPDATE liabilities SET normalized_name = ${normExpr} WHERE normalized_name IS NULL
    `);

    if ((assetRows ?? 0) > 0 || (liabRows ?? 0) > 0) {
      logger.info({ assetRows, liabRows }, "normalized_name backfill complete");
    }
  } catch (err) {
    logger.error({ err }, "normalized_name backfill failed — server starting anyway");
  }

  // ---------------------------------------------------------------------------
  // Idempotent DDL: add stripe_checkout_session_id to orders if missing.
  // ---------------------------------------------------------------------------
  try {
    await db.execute(sql`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT NOT NULL DEFAULT ''
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS orders_stripe_session_idx
      ON orders (stripe_checkout_session_id)
      WHERE stripe_checkout_session_id != ''
    `);
  } catch (err) {
    logger.error({ err }, "stripe_checkout_session_id migration failed — server starting anyway");
  }

  // ---------------------------------------------------------------------------
  // Start HTTP server
  // ---------------------------------------------------------------------------
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");
  });

  // Initialize Stripe in the background (non-blocking)
  initStripe().catch((err) => logger.error({ err }, "Stripe init threw unexpectedly"));

  // Background scheduler
  getVapidKeys().catch((err) => logger.error({ err }, "vapid init failed"));

  async function schedulerTick() {
    try {
      await runDailyResets();
      await runReminders();
    } catch (err) {
      logger.error({ err }, "scheduler tick failed");
    }
  }
  setTimeout(schedulerTick, 10_000);
  setInterval(schedulerTick, 5 * 60_000);
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
