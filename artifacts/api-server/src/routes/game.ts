import { Router, type IRouter } from "express";
import { db, gameStatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../middlewares/auth";
import { isValidState, syncNormalized, type GameState } from "../lib/game";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

// Current cloud state (single source of truth once migrated)
router.get("/game/state", requireAuth, async (req: AuthedRequest, res) => {
  const [row] = await db.select().from(gameStatesTable).where(eq(gameStatesTable.userId, req.userId!));
  if (!row) return res.status(404).json({ error: "No cloud state yet" });
  return res.json({ state: row.state, updatedAt: row.updatedAt });
});

// Save state (called by the game after each meaningful change)
router.put("/game/state", requireAuth, async (req: AuthedRequest, res) => {
  const state = req.body?.state as GameState;
  if (!isValidState(state)) return res.status(400).json({ error: "Invalid state" });
  await db
    .insert(gameStatesTable)
    .values({ userId: req.userId!, state, updatedAt: new Date() })
    .onConflictDoUpdate({ target: gameStatesTable.userId, set: { state, updatedAt: new Date() } });
  await syncNormalized(req.userId!, state);
  return res.json({ ok: true });
});

// One-time import of pre-account local progress. Idempotent: refuses to
// overwrite an existing cloud state, so repeating it never duplicates data.
router.post("/game/migrate", requireAuth, async (req: AuthedRequest, res) => {
  const state = req.body?.state as GameState;
  const [existing] = await db.select().from(gameStatesTable).where(eq(gameStatesTable.userId, req.userId!));
  if (existing) return res.json({ ok: true, migrated: false, reason: "cloud state already exists" });
  if (!isValidState(state)) return res.status(400).json({ error: "Invalid state" });
  await db.insert(gameStatesTable).values({ userId: req.userId!, state }).onConflictDoNothing();
  await syncNormalized(req.userId!, state);
  await logAudit({ userId: req.userId!, action: "local_progress_migrated" });
  return res.json({ ok: true, migrated: true });
});

export default router;
