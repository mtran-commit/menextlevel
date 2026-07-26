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

async function main() {
  // ---------------------------------------------------------------------------
  // Idempotent DML backfill — safe to re-run on every startup.
  // Populates normalized_name for any rows that existed before the column was
  // added (they land with NULL after Publish adds the nullable column).
  // This is pure data migration (no DDL) so it is always safe to run at
  // startup. It only touches rows where normalized_name IS NULL.
  // ---------------------------------------------------------------------------
  try {
    // SQL equivalent of: s.toLowerCase().trim().replace(/\s+/g," ").replace(/[^\w\s]/g,"").trim()
    const normExpr = sql.raw(`
      lower(trim(regexp_replace(
        regexp_replace(trim(name), '\\s+', ' ', 'g'),
        '[^[:alnum:]_[:space:]]', '', 'g'
      )))
    `);

    const { rowCount: assetRows } = await db.execute(sql`
      UPDATE assets
      SET normalized_name = ${normExpr}
      WHERE normalized_name IS NULL
    `);

    const { rowCount: liabRows } = await db.execute(sql`
      UPDATE liabilities
      SET normalized_name = ${normExpr}
      WHERE normalized_name IS NULL
    `);

    if ((assetRows ?? 0) > 0 || (liabRows ?? 0) > 0) {
      logger.info(
        { assetRows, liabRows },
        "normalized_name backfill complete",
      );
    }
  } catch (err) {
    // Non-fatal: server still starts. The partial unique index (WHERE normalized_name IS NOT NULL)
    // means existing NULL rows are excluded from uniqueness enforcement until the next write.
    logger.error({ err }, "normalized_name backfill failed — server starting anyway");
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

  // Background scheduler: timezone-aware daily resets + retention reminders.
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
