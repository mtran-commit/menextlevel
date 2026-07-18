import app from "./app";
import { logger } from "./lib/logger";
import { runDailyResets, runReminders } from "./lib/game";
import { getVapidKeys } from "./lib/notify";

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
