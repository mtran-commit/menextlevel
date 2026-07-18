import { db, auditLogsTable } from "@workspace/db";
import { logger } from "./logger";

export async function logAudit(entry: {
  actorId?: string | null;
  userId?: string | null;
  action: string;
  level?: "info" | "warn" | "error";
  details?: unknown;
}) {
  try {
    await db.insert(auditLogsTable).values({
      actorId: entry.actorId ?? null,
      userId: entry.userId ?? null,
      action: entry.action,
      level: entry.level ?? "info",
      details: entry.details ?? null,
    });
  } catch (err) {
    logger.error({ err }, "audit log write failed");
  }
}
