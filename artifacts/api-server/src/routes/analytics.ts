import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { analyticsEventsTable } from "@workspace/db/schema";

const ALLOWED_EVENTS = new Set([
  "landing_game_loaded",
  "onboarding_started",
  "asset_1_created",
  "asset_2_created",
  "asset_3_created",
  "liability_1_created",
  "liability_2_created",
  "liability_3_created",
  "first_asset_selected",
  "first_shot_attempted",
  "first_shot_scored",
  "onboarding_completed",
  "continued_as_guest",
  "signup_prompt_shown",
  "signup_started",
  "signup_completed",
  "guest_data_migrated",
]);

const router: IRouter = Router();

// Simple in-memory rate limiting: per client key, and a global cap as a
// backstop against distributed spam. Resets every minute.
const WINDOW_MS = 60_000;
const PER_KEY_LIMIT = 30; // events/min per anonId+IP
const GLOBAL_LIMIT = 3_000; // events/min across all clients
let windowStart = Date.now();
let globalCount = 0;
const perKey = new Map<string, number>();
function allow(key: string, n: number): boolean {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    globalCount = 0;
    perKey.clear();
  }
  const used = perKey.get(key) ?? 0;
  if (used + n > PER_KEY_LIMIT || globalCount + n > GLOBAL_LIMIT) return false;
  perKey.set(key, used + n);
  globalCount += n;
  return true;
}

/**
 * Public (guest-friendly) analytics ingestion. Accepts a small batch of
 * whitelisted funnel events. No auth required — guests are the whole point.
 */
router.post("/analytics/events", async (req, res) => {
  const { anonId, events } = req.body ?? {};
  if (typeof anonId !== "string" || anonId.length > 64 || !Array.isArray(events)) {
    return res.status(400).json({ error: "invalid payload" });
  }
  const rows = events
    .slice(0, 20)
    .filter(
      (e: unknown): e is { event: string; props?: Record<string, unknown> } =>
        !!e &&
        typeof (e as { event?: unknown }).event === "string" &&
        ALLOWED_EVENTS.has((e as { event: string }).event),
    )
    .map((e) => ({
      anonId,
      userId: null as string | null,
      event: e.event,
      // props capped to avoid junk payload storage
      props:
        e.props && typeof e.props === "object" && JSON.stringify(e.props).length <= 512 ? e.props : null,
    }));
  if (rows.length === 0) return res.json({ ok: true, recorded: 0 });
  const key = `${anonId}:${req.ip ?? ""}`;
  if (!allow(key, rows.length)) return res.status(429).json({ error: "rate limited" });
  await db.insert(analyticsEventsTable).values(rows);
  return res.json({ ok: true, recorded: rows.length });
});

export default router;
