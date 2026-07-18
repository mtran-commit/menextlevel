import { Router, type IRouter } from "express";
import { db, notificationsTable, pushSubscriptionsTable, userSettingsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";
import { DEFAULT_NOTIFICATION_PREFS, NOTIFICATION_TYPES, getVapidKeys } from "../lib/notify";

const router: IRouter = Router();

router.get("/notifications", requireAuth, async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, req.userId!))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  const unread = rows.filter((r) => !r.read).length;
  return res.json({ notifications: rows, unread });
});

router.post("/notifications/:id/read", requireAuth, async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Bad id" });
  await db
    .update(notificationsTable)
    .set({ read: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.userId!)));
  return res.json({ ok: true });
});

router.post("/notifications/read-all", requireAuth, async (req: AuthedRequest, res) => {
  await db.update(notificationsTable).set({ read: true }).where(eq(notificationsTable.userId, req.userId!));
  return res.json({ ok: true });
});

// ---------- Settings / notification preferences ----------
router.get("/settings", requireAuth, async (req: AuthedRequest, res) => {
  const [row] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, req.userId!));
  return res.json({
    notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS, ...((row?.notificationPrefs as object) ?? {}) },
    pushEnabled: row?.pushEnabled ?? false,
    types: NOTIFICATION_TYPES,
  });
});

router.put("/settings", requireAuth, async (req: AuthedRequest, res) => {
  const { notificationPrefs, pushEnabled } = req.body ?? {};
  const clean: Record<string, { inapp: boolean; push: boolean }> = { ...DEFAULT_NOTIFICATION_PREFS };
  if (notificationPrefs && typeof notificationPrefs === "object") {
    for (const t of NOTIFICATION_TYPES) {
      const p = (notificationPrefs as Record<string, { inapp?: unknown; push?: unknown }>)[t];
      if (p && typeof p === "object") {
        clean[t] = { inapp: Boolean(p.inapp), push: Boolean(p.push) };
      }
    }
  }
  await db
    .insert(userSettingsTable)
    .values({ userId: req.userId!, notificationPrefs: clean, pushEnabled: Boolean(pushEnabled) })
    .onConflictDoUpdate({
      target: userSettingsTable.userId,
      set: { notificationPrefs: clean, pushEnabled: Boolean(pushEnabled), updatedAt: new Date() },
    });
  return res.json({ ok: true });
});

// ---------- Web push ----------
router.get("/push/public-key", requireAuth, async (_req, res) => {
  const keys = await getVapidKeys();
  return res.json({ publicKey: keys.publicKey });
});

router.post("/push/subscribe", requireAuth, async (req: AuthedRequest, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return res.status(400).json({ error: "Invalid subscription" });
  }
  await db
    .insert(pushSubscriptionsTable)
    .values({ userId: req.userId!, endpoint: sub.endpoint, keys: sub.keys })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: { userId: req.userId!, keys: sub.keys },
    });
  await db
    .update(userSettingsTable)
    .set({ pushEnabled: true, updatedAt: new Date() })
    .where(eq(userSettingsTable.userId, req.userId!));
  return res.json({ ok: true });
});

router.delete("/push/subscribe", requireAuth, async (req: AuthedRequest, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint === "string") {
    await db
      .delete(pushSubscriptionsTable)
      .where(and(eq(pushSubscriptionsTable.userId, req.userId!), eq(pushSubscriptionsTable.endpoint, endpoint)));
  }
  return res.json({ ok: true });
});

export default router;
