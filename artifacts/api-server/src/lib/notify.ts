import webpush from "web-push";
import { db, appConfigTable, notificationsTable, pushSubscriptionsTable, userSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export const NOTIFICATION_TYPES = [
  "final_bell_reminder",
  "liabilities_unaddressed",
  "notme_winning",
  "one_more_asset",
  "milestone_approaching",
  "streak_at_risk",
  "milestone_achieved",
  "friend_challenge",
  "announcement",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const DEFAULT_NOTIFICATION_PREFS: Record<string, { inapp: boolean; push: boolean }> =
  Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, { inapp: true, push: true }]));

// ---------- VAPID key management (auto-generated, persisted in app_config) ----------
let vapid: { publicKey: string; privateKey: string } | null = null;

export async function getVapidKeys() {
  if (vapid) return vapid;
  const [row] = await db.select().from(appConfigTable).where(eq(appConfigTable.key, "vapid"));
  if (row) {
    vapid = row.value as { publicKey: string; privateKey: string };
  } else {
    const keys = webpush.generateVAPIDKeys();
    await db
      .insert(appConfigTable)
      .values({ key: "vapid", value: keys })
      .onConflictDoNothing();
    const [row2] = await db.select().from(appConfigTable).where(eq(appConfigTable.key, "vapid"));
    vapid = (row2?.value as typeof keys) ?? keys;
  }
  webpush.setVapidDetails("mailto:admin@menextlevel.com", vapid.publicKey, vapid.privateKey);
  return vapid;
}

async function getPrefs(userId: string) {
  const [row] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId));
  return {
    prefs: { ...DEFAULT_NOTIFICATION_PREFS, ...((row?.notificationPrefs as object) ?? {}) } as Record<
      string,
      { inapp: boolean; push: boolean }
    >,
    pushEnabled: row?.pushEnabled ?? false,
  };
}

export async function sendPushToUser(userId: string, payload: { title: string; body: string; type?: string }) {
  await getVapidKeys();
  const subs = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, userId));
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys as { p256dh: string; auth: string } },
        JSON.stringify(payload),
      );
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
      } else {
        logger.warn({ err }, "web push failed");
      }
    }
  }
}

/**
 * Create a notification for the user, respecting their per-type preferences.
 * dedupeKey prevents duplicates (e.g. one reminder of a type per day).
 */
export async function notifyUser(opts: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  dedupeKey?: string;
}) {
  const { prefs, pushEnabled } = await getPrefs(opts.userId);
  const pref = prefs[opts.type] ?? { inapp: true, push: true };
  if (!pref.inapp && !pref.push) return false;

  let created = false;
  if (pref.inapp) {
    const rows = await db
      .insert(notificationsTable)
      .values({
        userId: opts.userId,
        type: opts.type,
        title: opts.title,
        body: opts.body,
        dedupeKey: opts.dedupeKey ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: notificationsTable.id });
    created = rows.length > 0;
    if (opts.dedupeKey && !created) return false; // already sent, skip push too
  }
  if (pref.push && pushEnabled) {
    await sendPushToUser(opts.userId, { title: opts.title, body: opts.body, type: opts.type });
  }
  return created;
}
