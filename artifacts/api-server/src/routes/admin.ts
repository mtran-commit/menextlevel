import { Router, type IRouter } from "express";
import { clerkClient } from "@clerk/express";
import {
  achievementRulesTable,
  announcementsTable,
  auditLogsTable,
  assetsTable,
  dailyMatchesTable,
  db,
  liabilitiesTable,
  reportsTable,
  streaksTable,
  usersTable,
  notificationsTable,
} from "@workspace/db";
import { and, count, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { requireAuth, requireAdmin, type AuthedRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ONE-TIME admin role transfer endpoint. Protected by ADMIN_TRANSFER_SECRET env var.
// Safe to call multiple times — idempotent after the transfer is complete.
// Remove this endpoint and redeploy once the transfer is confirmed.
router.post("/admin/transfer", async (req, res) => {
  const secret = process.env.ADMIN_TRANSFER_SECRET;
  if (!secret || req.headers["x-transfer-secret"] !== secret) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { targetUserId } = req.body as { targetUserId?: string };
  if (!targetUserId) return res.status(400).json({ error: "targetUserId required" });

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId));
  if (!target) return res.status(404).json({ error: "Target user not found" });
  if (target.role === "admin") return res.json({ ok: true, message: "Already admin — no change needed" });

  const [currentAdmin] = await db.select().from(usersTable).where(eq(usersTable.role, "admin")).limit(1);

  // Promote target to admin
  await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, targetUserId));

  // Demote previous admin to user (if one existed and it's different)
  if (currentAdmin && currentAdmin.id !== targetUserId) {
    await db.update(usersTable).set({ role: "user" }).where(eq(usersTable.id, currentAdmin.id));
  }

  await logAudit({
    actorId: "system",
    userId: targetUserId,
    action: "admin_role_transferred",
    details: {
      from: currentAdmin ? { id: currentAdmin.id, email: currentAdmin.email } : null,
      to: { id: target.id, email: target.email },
    },
  });

  return res.json({
    ok: true,
    transferred: { from: currentAdmin?.email ?? null, to: target.email },
  });
});

// Bootstrap: the very first user may claim super-admin (only while no admin exists).
router.post("/admin/claim", requireAuth, async (req: AuthedRequest, res) => {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.role, "admin")).limit(1);
  if (existing) return res.status(403).json({ error: "An admin already exists" });
  await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, req.userId!));
  await logAudit({ actorId: req.userId!, action: "admin_claimed" });
  return res.json({ ok: true });
});

router.use("/admin", requireAuth, requireAdmin);

// ---------- Users ----------
router.get("/admin/users", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const where = q
    ? or(ilike(usersTable.email, `%${q}%`), ilike(usersTable.username, `%${q}%`), eq(usersTable.id, q))
    : undefined;
  const users = await db
    .select({
      user: usersTable,
      streak: streaksTable.current,
      best: streaksTable.best,
    })
    .from(usersTable)
    .leftJoin(streaksTable, eq(streaksTable.userId, usersTable.id))
    .where(where)
    .orderBy(desc(usersTable.createdAt))
    .limit(200);
  return res.json({ users });
});

router.post("/admin/users/:id/status", async (req: AuthedRequest, res) => {
  const status = req.body?.status;
  if (status !== "active" && status !== "suspended") return res.status(400).json({ error: "Bad status" });
  const [user] = await db.update(usersTable).set({ status }).where(eq(usersTable.id, String(req.params.id))).returning();
  if (!user) return res.status(404).json({ error: "Not found" });
  await logAudit({ actorId: req.userId!, userId: user.id, action: `user_${status}` });
  return res.json({ user });
});

router.delete("/admin/users/:id", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  await logAudit({ actorId: req.userId!, userId: id, action: "account_deleted_by_admin" });
  await db.delete(usersTable).where(eq(usersTable.id, id));
  try {
    await clerkClient.users.deleteUser(id);
  } catch (err) {
    logger.error({ err }, "clerk user deletion failed");
  }
  return res.json({ ok: true });
});

// ---------- Stats ----------
router.get("/admin/stats", async (_req, res) => {
  const [{ value: totalUsers }] = await db.select({ value: count() }).from(usersTable);
  const since7 = new Date(Date.now() - 7 * 86400000);
  const since1 = new Date(Date.now() - 86400000);
  const [{ value: dau }] = await db.select({ value: count() }).from(usersTable).where(gte(usersTable.lastSeenAt, since1));
  const [{ value: wau }] = await db.select({ value: count() }).from(usersTable).where(gte(usersTable.lastSeenAt, since7));
  const [{ value: matches }] = await db.select({ value: count() }).from(dailyMatchesTable);
  const [{ value: totalAssetsCompleted }] = await db.select({ value: count() }).from(assetsTable);
  const [{ value: totalLiabilitiesDefeated }] = await db.select({ value: count() }).from(liabilitiesTable);

  const streakStats = await db
    .select({
      avg: sql<number>`coalesce(avg(${streaksTable.current}),0)::float`,
      max: sql<number>`coalesce(max(${streaksTable.current}),0)::int`,
      maxBest: sql<number>`coalesce(max(${streaksTable.best}),0)::int`,
    })
    .from(streaksTable);

  const topAssets = await db
    .select({ name: assetsTable.name, uses: count() })
    .from(assetsTable)
    .groupBy(assetsTable.name)
    .orderBy(desc(count()))
    .limit(10);
  const topLiabilities = await db
    .select({ name: liabilitiesTable.name, uses: count() })
    .from(liabilitiesTable)
    .groupBy(liabilitiesTable.name)
    .orderBy(desc(count()))
    .limit(10);

  const dailyActive = await db
    .select({ date: dailyMatchesTable.date, players: count() })
    .from(dailyMatchesTable)
    .groupBy(dailyMatchesTable.date)
    .orderBy(desc(dailyMatchesTable.date))
    .limit(14);

  return res.json({
    totalUsers,
    dau,
    wau,
    totalMatches: matches,
    totalAssetsCompleted,
    totalLiabilitiesDefeated,
    streaks: streakStats[0],
    topAssets,
    topLiabilities,
    dailyActive,
  });
});

// ---------- Reports ----------
router.get("/admin/reports", async (req, res) => {
  const status = String(req.query.status ?? "open");
  const rows = await db
    .select()
    .from(reportsTable)
    .where(status === "all" ? undefined : eq(reportsTable.status, status))
    .orderBy(desc(reportsTable.createdAt))
    .limit(100);
  return res.json({ reports: rows });
});

router.post("/admin/reports/:id/status", async (req: AuthedRequest, res) => {
  const status = req.body?.status;
  if (!["open", "resolved", "dismissed"].includes(status)) return res.status(400).json({ error: "Bad status" });
  const id = Number(req.params.id);
  const [report] = await db.update(reportsTable).set({ status }).where(eq(reportsTable.id, id)).returning();
  await logAudit({ actorId: req.userId!, action: "report_" + status, details: { reportId: id } });
  return res.json({ report });
});

// ---------- Announcements ----------
router.get("/admin/announcements", async (_req, res) => {
  const rows = await db.select().from(announcementsTable).orderBy(desc(announcementsTable.createdAt)).limit(100);
  return res.json({ announcements: rows });
});

router.post("/admin/announcements", async (req: AuthedRequest, res) => {
  const { title, body } = req.body ?? {};
  if (!title || !body) return res.status(400).json({ error: "title and body required" });
  const [a] = await db.insert(announcementsTable).values({ title: String(title), body: String(body) }).returning();
  // fan out as in-app notifications
  const users = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.status, "active"));
  for (const u of users) {
    await db
      .insert(notificationsTable)
      .values({ userId: u.id, type: "announcement", title: a.title, body: a.body, dedupeKey: `announcement_${a.id}` })
      .onConflictDoNothing();
  }
  await logAudit({ actorId: req.userId!, action: "announcement_created", details: { id: a.id } });
  return res.json({ announcement: a });
});

router.patch("/admin/announcements/:id", async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const { active } = req.body ?? {};
  const [a] = await db.update(announcementsTable).set({ active: Boolean(active) }).where(eq(announcementsTable.id, id)).returning();
  return res.json({ announcement: a });
});

// ---------- Achievement rules ----------
router.get("/admin/achievement-rules", async (_req, res) => {
  const rows = await db.select().from(achievementRulesTable).orderBy(achievementRulesTable.milestone);
  return res.json({ rules: rows });
});

router.put("/admin/achievement-rules/:milestone", async (req: AuthedRequest, res) => {
  const milestone = Number(req.params.milestone);
  const { title, description, enabled } = req.body ?? {};
  if (!Number.isInteger(milestone)) return res.status(400).json({ error: "Bad milestone" });
  const [rule] = await db
    .insert(achievementRulesTable)
    .values({ milestone, title: String(title ?? ""), description: String(description ?? ""), enabled: enabled !== false })
    .onConflictDoUpdate({
      target: achievementRulesTable.milestone,
      set: { title: String(title ?? ""), description: String(description ?? ""), enabled: enabled !== false },
    })
    .returning();
  await logAudit({ actorId: req.userId!, action: "achievement_rule_updated", details: { milestone } });
  return res.json({ rule });
});

// ---------- Audit logs / errors ----------
router.get("/admin/audit-logs", async (req, res) => {
  const level = String(req.query.level ?? "all");
  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(level === "all" ? undefined : eq(auditLogsTable.level, level))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(200);
  return res.json({ logs: rows });
});

export default router;

// ---------- User-facing report endpoint (mounted under /api via index) ----------
export const reportRouter: IRouter = Router();
reportRouter.post("/reports", requireAuth, async (req: AuthedRequest, res) => {
  const { targetType, targetContent, reason, targetUserId } = req.body ?? {};
  if (!reason) return res.status(400).json({ error: "reason required" });
  const [r] = await db
    .insert(reportsTable)
    .values({
      reporterId: req.userId!,
      targetType: String(targetType ?? "other"),
      targetContent: targetContent ? String(targetContent).slice(0, 500) : null,
      targetUserId: targetUserId ? String(targetUserId) : null,
      reason: String(reason).slice(0, 1000),
    })
    .returning();
  return res.json({ report: r });
});

// Active announcements for signed-in users
export const announcementsPublicRouter: IRouter = Router();
announcementsPublicRouter.get("/announcements", requireAuth, async (_req, res) => {
  const rows = await db
    .select()
    .from(announcementsTable)
    .where(eq(announcementsTable.active, true))
    .orderBy(desc(announcementsTable.createdAt))
    .limit(10);
  return res.json({ announcements: rows });
});
