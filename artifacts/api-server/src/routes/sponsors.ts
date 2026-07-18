import { Router, type IRouter } from "express";
import { db, sponsorCampaignsTable, sponsorEventsTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireAuth, requireAdmin, type AuthedRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

/* ============================ Public delivery ============================ */

const SPONSOR_EVENTS = new Set([
  "sponsor_impression",
  "sponsor_click",
  "sponsor_campaign_view",
  "sponsor_placement",
  "sponsor_milestone_view",
]);

// In-memory rate limiting (same pattern as analytics).
const WINDOW_MS = 60_000;
const PER_KEY_LIMIT = 60;
const GLOBAL_LIMIT = 5_000;
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

type Targeting = {
  countries?: string[];
  regions?: string[];
  ageMin?: number;
  ageMax?: number;
  devices?: string[];
  audience?: string;
} | null;

/**
 * Active campaigns for the arena boards. Guest-friendly, cache-light.
 * Optional targeting is matched only on non-sensitive dimensions the client
 * self-reports (device type, guest vs registered). Country/region/age are
 * supported in the schema but only enforced when the request carries them.
 * Sensitive game data (assets/liabilities/fans/doubters) is never involved.
 */
router.get("/sponsors/active", async (req, res) => {
  const device = req.query.device === "mobile" ? "mobile" : "desktop";
  const audience = req.query.audience === "registered" ? "registered" : "guest";
  const country = typeof req.query.country === "string" ? req.query.country.toUpperCase() : null;
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(sponsorCampaignsTable)
    .where(
      and(
        eq(sponsorCampaignsTable.active, true),
        sql`(${sponsorCampaignsTable.startDate} IS NULL OR ${sponsorCampaignsTable.startDate} <= ${today})`,
        sql`(${sponsorCampaignsTable.endDate} IS NULL OR ${sponsorCampaignsTable.endDate} >= ${today})`,
      ),
    )
    .orderBy(desc(sponsorCampaignsTable.priority), desc(sponsorCampaignsTable.createdAt))
    .limit(40);
  const campaigns = rows
    .filter((c) => {
      const t = c.targeting as Targeting;
      if (!t) return true;
      if (t.devices?.length && !t.devices.includes(device)) return false;
      if (t.audience && t.audience !== "all" && t.audience !== audience) return false;
      if (t.countries?.length && country && !t.countries.map((x) => x.toUpperCase()).includes(country)) return false;
      return true;
    })
    .slice(0, 20)
    .map((c) => ({
      id: c.id,
      adType: c.adType,
      sponsorName: c.sponsorName,
      textContent: c.textContent,
      ctaText: c.ctaText,
      destinationUrl: c.destinationUrl,
      logoData: c.logoData,
      bannerData: c.bannerData,
      placement: c.placement,
      durationSec: c.durationSec,
      priority: c.priority,
      frequency: c.frequency,
    }));
  res.setHeader("Cache-Control", "public, max-age=60");
  return res.json({ campaigns });
});

/** Guest-friendly sponsor analytics ingestion (batched, whitelisted, rate-limited). */
router.post("/sponsors/events", async (req, res) => {
  const { anonId, events } = req.body ?? {};
  if (typeof anonId !== "string" || anonId.length > 64 || !Array.isArray(events)) {
    return res.status(400).json({ error: "invalid payload" });
  }
  const rows = events
    .slice(0, 30)
    .filter(
      (e: unknown): e is { campaignId: number; event: string; placement?: string; device?: string; audience?: string } =>
        !!e &&
        Number.isInteger((e as { campaignId?: unknown }).campaignId) &&
        SPONSOR_EVENTS.has(String((e as { event?: unknown }).event)),
    )
    .map((e) => ({
      campaignId: e.campaignId,
      event: e.event,
      placement: typeof e.placement === "string" ? e.placement.slice(0, 24) : null,
      device: e.device === "mobile" ? "mobile" : "desktop",
      audience: e.audience === "registered" ? "registered" : "guest",
      anonId,
    }));
  if (rows.length === 0) return res.json({ ok: true, recorded: 0 });
  const key = `${anonId}:${req.ip ?? ""}`;
  if (!allow(key, rows.length)) return res.status(429).json({ error: "rate limited" });
  try {
    await db.insert(sponsorEventsTable).values(rows);
  } catch {
    return res.json({ ok: true, recorded: 0 }); // unknown campaign ids etc. — never break the game
  }
  return res.json({ ok: true, recorded: rows.length });
});

/* ============================ Super Admin ============================ */

router.use("/admin/sponsors", requireAuth, requireAdmin);

const PLACEMENTS = new Set(["left", "right", "backboard", "ribbon", "any"]);
const AD_TYPES = new Set(["logo", "text", "banner"]);
const MAX_IMG = 400_000; // ~300KB binary as data URL

function sanitize(body: Record<string, unknown>, partial: boolean) {
  const errors: string[] = [];
  const out: Record<string, unknown> = {};
  const str = (k: string, max: number, required = false) => {
    if (body[k] === undefined) {
      if (required && !partial) errors.push(`${k} required`);
      return;
    }
    const v = String(body[k] ?? "").trim();
    if (required && !v) errors.push(`${k} required`);
    if (v.length > max) errors.push(`${k} too long`);
    out[k] = v || null;
  };
  str("name", 120, true);
  str("sponsorName", 80, true);
  str("textContent", 160);
  str("ctaText", 80);
  if (body.adType !== undefined) {
    if (!AD_TYPES.has(String(body.adType))) errors.push("bad adType");
    else out.adType = body.adType;
  }
  if (body.placement !== undefined) {
    if (!PLACEMENTS.has(String(body.placement))) errors.push("bad placement");
    else out.placement = body.placement;
  }
  if (body.destinationUrl !== undefined) {
    const v = String(body.destinationUrl ?? "").trim();
    if (v && !/^https?:\/\/[^\s]+$/i.test(v)) errors.push("destinationUrl must be http(s)");
    else out.destinationUrl = v || null;
  }
  for (const k of ["logoData", "bannerData"] as const) {
    if (body[k] !== undefined) {
      const v = String(body[k] ?? "");
      if (v && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(v)) errors.push(`${k} must be a PNG/JPEG/WebP/GIF data URL`);
      else if (v.length > MAX_IMG) errors.push(`${k} too large (max ~300KB)`);
      else out[k] = v || null;
    }
  }
  for (const k of ["startDate", "endDate"] as const) {
    if (body[k] !== undefined) {
      const v = String(body[k] ?? "").trim();
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors.push(`${k} must be YYYY-MM-DD`);
      else out[k] = v || null;
    }
  }
  for (const [k, min, max, dflt] of [["durationSec", 3, 60, 8], ["priority", 0, 100, 0], ["frequency", 1, 10, 1]] as const) {
    if (body[k] !== undefined) {
      const v = Number(body[k]);
      if (!Number.isInteger(v) || v < min || v > max) errors.push(`${k} must be ${min}-${max}`);
      else out[k] = v;
    } else if (!partial) out[k] = dflt;
  }
  if (body.active !== undefined) out.active = !!body.active;
  if (body.targeting !== undefined) {
    const t = body.targeting;
    if (t === null) out.targeting = null;
    else if (typeof t === "object" && JSON.stringify(t).length <= 2000) {
      const tt = t as Record<string, unknown>;
      // Only non-sensitive dimensions are accepted; anything else is dropped.
      out.targeting = {
        ...(Array.isArray(tt.countries) ? { countries: tt.countries.slice(0, 30).map(String) } : {}),
        ...(Array.isArray(tt.regions) ? { regions: tt.regions.slice(0, 30).map(String) } : {}),
        ...(Number.isInteger(tt.ageMin) ? { ageMin: tt.ageMin } : {}),
        ...(Number.isInteger(tt.ageMax) ? { ageMax: tt.ageMax } : {}),
        ...(Array.isArray(tt.devices) ? { devices: tt.devices.slice(0, 2).map(String) } : {}),
        ...(typeof tt.audience === "string" ? { audience: tt.audience } : {}),
      };
    } else errors.push("bad targeting");
  }
  return { out, errors };
}

router.get("/admin/sponsors", async (_req, res) => {
  const campaigns = await db.select().from(sponsorCampaignsTable).orderBy(desc(sponsorCampaignsTable.createdAt));
  const stats = await db
    .select({
      campaignId: sponsorEventsTable.campaignId,
      event: sponsorEventsTable.event,
      placement: sponsorEventsTable.placement,
      n: sql<number>`count(*)::int`,
    })
    .from(sponsorEventsTable)
    .groupBy(sponsorEventsTable.campaignId, sponsorEventsTable.event, sponsorEventsTable.placement);
  return res.json({ campaigns, stats });
});

router.post("/admin/sponsors", async (req: AuthedRequest, res) => {
  const { out, errors } = sanitize(req.body ?? {}, false);
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });
  const [campaign] = await db.insert(sponsorCampaignsTable).values(out as typeof sponsorCampaignsTable.$inferInsert).returning();
  await logAudit({ actorId: req.userId!, action: "sponsor_campaign_created", details: { id: campaign.id, name: campaign.name } });
  return res.json({ campaign });
});

router.patch("/admin/sponsors/:id", async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
  const { out, errors } = sanitize(req.body ?? {}, true);
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });
  out.updatedAt = new Date();
  const [campaign] = await db.update(sponsorCampaignsTable).set(out).where(eq(sponsorCampaignsTable.id, id)).returning();
  if (!campaign) return res.status(404).json({ error: "Not found" });
  await logAudit({ actorId: req.userId!, action: "sponsor_campaign_updated", details: { id, fields: Object.keys(out) } });
  return res.json({ campaign });
});

router.delete("/admin/sponsors/:id", async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
  const [campaign] = await db.delete(sponsorCampaignsTable).where(eq(sponsorCampaignsTable.id, id)).returning();
  if (!campaign) return res.status(404).json({ error: "Not found" });
  await logAudit({ actorId: req.userId!, action: "sponsor_campaign_deleted", details: { id, name: campaign.name } });
  return res.json({ ok: true });
});

export default router;
