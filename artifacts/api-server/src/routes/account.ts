import { Router, type IRouter } from "express";
import { clerkClient } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/account/profile", requireAuth, async (req: AuthedRequest, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  return res.json({ user });
});

router.patch("/account/profile", requireAuth, async (req: AuthedRequest, res) => {
  const { username, signature, timezone } = req.body ?? {};
  const set: Record<string, string> = {};
  if (typeof username === "string" && username.trim()) set.username = username.trim().slice(0, 40);
  if (typeof signature === "string" && signature.trim()) set.signature = signature.trim().slice(0, 60);
  if (typeof timezone === "string" && timezone.trim()) set.timezone = timezone.trim().slice(0, 64);
  if (Object.keys(set).length === 0) return res.status(400).json({ error: "Nothing to update" });
  const [user] = await db.update(usersTable).set(set).where(eq(usersTable.id, req.userId!)).returning();
  await logAudit({ userId: req.userId!, actorId: req.userId!, action: "profile_updated", details: set });
  return res.json({ user });
});

// Permanently delete account + all personal data (cascades through all tables),
// then delete the Clerk user so authentication data is gone too.
router.delete("/account", requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  await logAudit({ actorId: userId, action: "account_deleted_self" });
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  try {
    await clerkClient.users.deleteUser(userId);
  } catch (err) {
    logger.error({ err }, "clerk user deletion failed");
  }
  return res.json({ ok: true });
});

export default router;
