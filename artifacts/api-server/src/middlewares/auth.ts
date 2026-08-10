import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, usersTable, userSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { DEFAULT_NOTIFICATION_PREFS } from "../lib/notify";
import jwt from "jsonwebtoken";

export interface AuthedRequest extends Request {
  userId?: string;
  userRole?: string;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    // Admin cookie check — bypasses Clerk entirely
    const adminToken = (req as any).cookies?.admin_token;
    if (adminToken) {
      try {
        const secret = process.env.ADMIN_JWT_SECRET ?? "";
        const payload = jwt.verify(adminToken, secret) as { sub: string; role: string };
        if (payload.role === "admin") {
          req.userId = "admin";
          req.userRole = "admin";
          return next();
        }
      } catch {
        // Invalid or expired token — fall through to Clerk
      }
    }

    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // JIT provision the local user row
    let [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      let email: string | null = null;
      let username: string | null = null;
      try {
        const cu = await clerkClient.users.getUser(userId);
        email = cu.primaryEmailAddress?.emailAddress ?? null;
        username = cu.username || cu.firstName || email?.split("@")[0] || null;
      } catch {
        /* clerk lookup best-effort */
      }
      const tz = (req.header("x-timezone") || "UTC").slice(0, 64);
      [user] = await db
        .insert(usersTable)
        .values({ id: userId, email, username, timezone: tz })
        .onConflictDoNothing()
        .returning();
      if (!user) [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
      await db
        .insert(userSettingsTable)
        .values({ userId, notificationPrefs: DEFAULT_NOTIFICATION_PREFS })
        .onConflictDoNothing();
    } else {
      const tz = req.header("x-timezone");
      await db
        .update(usersTable)
        .set({
          lastSeenAt: sql`now()`,
          ...(tz && tz !== user.timezone ? { timezone: tz.slice(0, 64) } : {}),
        })
        .where(eq(usersTable.id, userId));
    }

    if (user.status === "suspended") {
      return res.status(403).json({ error: "Account suspended" });
    }

    req.userId = userId;
    req.userRole = user.role;
    return next();
  } catch (err) {
    return next(err);
  }
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.userRole !== "admin") return res.status(403).json({ error: "Admin only" });
  return next();
}
