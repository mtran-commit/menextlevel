import { Router, type IRouter } from "express";
import { db, ordersTable, orderItemsTable, productsTable } from "@workspace/db";
import { asc, desc, eq, ilike, or, and, gte, lte, count, sum, sql, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin, type AuthedRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { syncOrderShippingFromStripe, isAddressPopulated } from "../lib/orderSync";

const router: IRouter = Router();

const VALID_ORDER_STATUSES = ["new", "paid", "processing", "packed", "shipped", "delivered", "cancelled", "refunded"];
const VALID_PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"];

router.use("/admin/orders", requireAuth, requireAdmin);

// ── Dashboard stats ───────────────────────────────────────────────────────────

router.get("/admin/orders/stats", async (_req, res) => {
  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totals] = await db
    .select({
      totalOrders: count(ordersTable.id),
      revenue: sum(sql<string>`CAST(${ordersTable.total} AS NUMERIC)`),
    })
    .from(ordersTable)
    .where(eq(ordersTable.paymentStatus, "paid"));

  const [newOrders] = await db
    .select({ count: count(ordersTable.id) })
    .from(ordersTable)
    .where(eq(ordersTable.orderStatus, "new"));

  const [today] = await db
    .select({ count: count(ordersTable.id) })
    .from(ordersTable)
    .where(gte(ordersTable.createdAt, startOfDay));

  const [thisWeek] = await db
    .select({ count: count(ordersTable.id) })
    .from(ordersTable)
    .where(gte(ordersTable.createdAt, startOfWeek));

  const [thisMonth] = await db
    .select({ count: count(ordersTable.id) })
    .from(ordersTable)
    .where(gte(ordersTable.createdAt, startOfMonth));

  // Best-selling kit by quantity
  const bestSeller = await db
    .select({
      productName: orderItemsTable.productName,
      totalQty: sum(orderItemsTable.quantity),
    })
    .from(orderItemsTable)
    .groupBy(orderItemsTable.productName)
    .orderBy(desc(sum(orderItemsTable.quantity)))
    .limit(1);

  return res.json({
    totalOrders: Number(totals?.totalOrders ?? 0),
    newOrders: Number(newOrders?.count ?? 0),
    revenue: totals?.revenue ? parseFloat(String(totals.revenue)).toFixed(2) : "0.00",
    ordersToday: Number(today?.count ?? 0),
    ordersThisWeek: Number(thisWeek?.count ?? 0),
    ordersThisMonth: Number(thisMonth?.count ?? 0),
    bestSeller: bestSeller[0]?.productName ?? null,
  });
});

// ── List orders with search + filter ─────────────────────────────────────────

router.get("/admin/orders", async (req, res) => {
  const { q, orderStatus, paymentStatus, productSlug, dateFrom, dateTo, page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  if (q) {
    conditions.push(
      or(
        ilike(ordersTable.customerName, `%${q}%`),
        ilike(ordersTable.customerEmail, `%${q}%`),
        ilike(ordersTable.orderNumber, `%${q}%`)
      )
    );
  }
  if (orderStatus && VALID_ORDER_STATUSES.includes(orderStatus)) {
    conditions.push(eq(ordersTable.orderStatus, orderStatus));
  }
  if (paymentStatus && VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
    conditions.push(eq(ordersTable.paymentStatus, paymentStatus));
  }
  if (dateFrom) {
    const d = new Date(dateFrom); if (!isNaN(d.getTime())) conditions.push(gte(ordersTable.createdAt, d));
  }
  if (dateTo) {
    const d = new Date(dateTo); d.setHours(23, 59, 59, 999); if (!isNaN(d.getTime())) conditions.push(lte(ordersTable.createdAt, d));
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const orders = await db
    .select()
    .from(ordersTable)
    .where(where)
    .orderBy(desc(ordersTable.createdAt))
    .limit(limitNum)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: count(ordersTable.id) })
    .from(ordersTable)
    .where(where);

  // Fetch items for these orders
  const orderIds = orders.map(o => o.id);
  let items: (typeof orderItemsTable.$inferSelect)[] = [];
  if (orderIds.length) {
    try {
      items = await db.select().from(orderItemsTable).where(inArray(orderItemsTable.orderId, orderIds));
    } catch {
      // order_items table may not exist yet — return orders without items
      items = [];
    }
  }

  const itemsByOrder = items.reduce<Record<number, typeof items>>((acc, item) => {
    (acc[item.orderId] ??= []).push(item);
    return acc;
  }, {});

  return res.json({
    orders: orders.map(o => ({ ...o, items: itemsByOrder[o.id] ?? [] })),
    total: Number(total),
    page: pageNum,
    limit: limitNum,
  });
});

// ── Single order ──────────────────────────────────────────────────────────────

router.get("/admin/orders/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id)).limit(1);
  if (!order) return res.status(404).json({ error: "Not found" });
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, id));
  return res.json({ order: { ...order, items } });
});

// ── Sync shipping/customer details from Stripe ────────────────────────────────
// Uses the shared syncOrderShippingFromStripe function from orderSync.ts.
// This is the same logic used by the webhook handler and any future backfill.

router.post("/admin/orders/:id/sync-stripe", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id)).limit(1);
  if (!order) return res.status(404).json({ error: "Not found" });

  if (!order.stripeCheckoutSessionId && !order.stripePaymentId) {
    return res.status(400).json({ error: "No Stripe session or payment ID on this order" });
  }

  let stripe;
  try { stripe = await getUncachableStripeClient(); }
  catch { return res.status(500).json({ error: "Stripe not connected" }); }

  try {
    const updated = await syncOrderShippingFromStripe(order, stripe);
    return res.json({ order: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Stripe sync failed" });
  }
});

// ── Bulk backfill: sync shipping for all paid orders missing an address ────────

router.post("/admin/orders/backfill-addresses", async (_req, res) => {
  let stripe;
  try { stripe = await getUncachableStripeClient(); }
  catch { return res.status(500).json({ error: "Stripe not connected" }); }

  // Find all paid orders that have a Stripe reference but no shipping address yet.
  const orders = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.paymentStatus, "paid"),
        sql`(${ordersTable.shippingAddress}->>'line1') IS NULL OR (${ordersTable.shippingAddress}->>'line1') = ''`
      )
    );

  const results: { orderNumber: string; success: boolean; error?: string }[] = [];

  for (const order of orders) {
    if (!order.stripeCheckoutSessionId && !order.stripePaymentId) {
      results.push({ orderNumber: order.orderNumber, success: false, error: "no Stripe reference" });
      continue;
    }
    try {
      await syncOrderShippingFromStripe(order, stripe);
      results.push({ orderNumber: order.orderNumber, success: true });
    } catch (err: any) {
      results.push({ orderNumber: order.orderNumber, success: false, error: err?.message });
    }
  }

  return res.json({ processed: results.length, results });
});

// ── Create order (used by checkout flow later) ────────────────────────────────

router.post("/admin/orders", async (req: AuthedRequest, res) => {
  const body = req.body ?? {};
  const orderNumber = body.orderNumber ?? `MNL-${Date.now()}`;
  const [order] = await db.insert(ordersTable).values({
    orderNumber,
    userId: body.userId ?? null,
    customerName: String(body.customerName ?? "").trim(),
    customerEmail: String(body.customerEmail ?? "").trim(),
    customerPhone: String(body.customerPhone ?? "").trim(),
    shippingAddress: body.shippingAddress ?? {},
    subtotal: String(body.subtotal ?? "0.00"),
    shipping: String(body.shipping ?? "0.00"),
    total: String(body.total ?? "0.00"),
    currency: String(body.currency ?? "AUD").toUpperCase(),
    paymentStatus: body.paymentStatus ?? "pending",
    orderStatus: body.orderStatus ?? "new",
    stripePaymentId: String(body.stripePaymentId ?? ""),
    adminNotes: String(body.adminNotes ?? ""),
  }).returning();

  // Insert items
  if (Array.isArray(body.items) && body.items.length) {
    await db.insert(orderItemsTable).values(
      body.items.map((item: any) => ({
        orderId: order.id,
        productId: item.productId ?? null,
        productName: String(item.productName ?? ""),
        productSlug: String(item.productSlug ?? ""),
        quantity: parseInt(String(item.quantity ?? 1), 10) || 1,
        unitPrice: String(item.unitPrice ?? "0.00"),
        currency: String(item.currency ?? "AUD").toUpperCase(),
      }))
    );
  }
  await logAudit({ actorId: req.userId!, action: "order_created", details: { orderId: order.id, orderNumber } });
  return res.status(201).json({ order });
});

// ── Update order (status, tracking, notes) ───────────────────────────────────

router.put("/admin/orders/:id", async (req: AuthedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const body = req.body ?? {};
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.orderStatus !== undefined && VALID_ORDER_STATUSES.includes(body.orderStatus))   updates.orderStatus = body.orderStatus;
  if (body.paymentStatus !== undefined && VALID_PAYMENT_STATUSES.includes(body.paymentStatus)) updates.paymentStatus = body.paymentStatus;
  if (body.trackingNumber !== undefined) updates.trackingNumber = String(body.trackingNumber).trim();
  if (body.courier !== undefined)        updates.courier = String(body.courier).trim();
  if (body.adminNotes !== undefined)     updates.adminNotes = String(body.adminNotes).trim();
  if (body.stripePaymentId !== undefined) updates.stripePaymentId = String(body.stripePaymentId).trim();
  const [order] = await db.update(ordersTable).set(updates).where(eq(ordersTable.id, id)).returning();
  if (!order) return res.status(404).json({ error: "Not found" });
  await logAudit({ actorId: req.userId!, action: "order_updated", details: { orderId: id, updates: Object.keys(updates) } });
  return res.json({ order });
});

// ── Delete order ──────────────────────────────────────────────────────────────

router.delete("/admin/orders/:id", async (req: AuthedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  await db.delete(ordersTable).where(eq(ordersTable.id, id));
  await logAudit({ actorId: req.userId!, action: "order_deleted", details: { orderId: id } });
  return res.json({ ok: true });
});

export default router;
