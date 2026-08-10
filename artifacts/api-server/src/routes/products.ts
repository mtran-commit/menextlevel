import { Router, type IRouter } from "express";
import { db, productsTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { requireAuth, requireAdmin, type AuthedRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();

// ── Public ───────────────────────────────────────────────────────────────────

router.get("/products", async (_req, res) => {
  const products = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.active, true))
    .orderBy(asc(productsTable.displayOrder), asc(productsTable.id));
  return res.json({ products });
});

router.get("/products/:slug", async (req, res) => {
  const [product] = await db
    .select()
    .from(productsTable)
    .where(
      and(
        eq(productsTable.slug, req.params.slug),
        eq(productsTable.active, true)
      )
    )
    .limit(1);
  if (!product) return res.status(404).json({ error: "Not found" });
  return res.json({ product });
});

// ── Admin (auth + admin role required) ───────────────────────────────────────

router.use("/admin/products", requireAuth, requireAdmin);

router.get("/admin/products", async (_req, res) => {
  const products = await db
    .select()
    .from(productsTable)
    .orderBy(asc(productsTable.displayOrder), asc(productsTable.id));
  return res.json({ products });
});

router.post("/admin/products", async (req: AuthedRequest, res) => {
  const body = req.body ?? {};
  const { name, slug, shortDescription, description, whatsIncluded, price, currency, imageUrl, active, soldOut, stockQuantity, displayOrder } = body;
  if (!String(name ?? "").trim() || !String(slug ?? "").trim()) {
    return res.status(400).json({ error: "name and slug are required" });
  }
  const safeSlug = String(slug).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const [product] = await db
    .insert(productsTable)
    .values({
      name: String(name).trim(),
      slug: safeSlug,
      shortDescription: String(shortDescription ?? "").trim(),
      description: String(description ?? "").trim(),
      whatsIncluded: String(whatsIncluded ?? "").trim(),
      price: String(price ?? "0.00").trim(),
      currency: String(currency ?? "AUD").toUpperCase().trim(),
      imageUrl: String(imageUrl ?? "").trim(),
      active: active !== false && active !== "false",
      soldOut: soldOut === true || soldOut === "true",
      stockQuantity: stockQuantity != null ? parseInt(String(stockQuantity), 10) || null : null,
      displayOrder: Math.max(0, parseInt(String(displayOrder ?? "0"), 10) || 0),
    })
    .returning();
  await logAudit({ actorId: req.userId!, action: "product_created", details: { productId: product.id, name: product.name } });
  return res.status(201).json({ product });
});

router.put("/admin/products/:id", async (req: AuthedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const body = req.body ?? {};
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined)             updates.name = String(body.name).trim();
  if (body.slug !== undefined)             updates.slug = String(body.slug).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (body.shortDescription !== undefined) updates.shortDescription = String(body.shortDescription).trim();
  if (body.description !== undefined)      updates.description = String(body.description).trim();
  if (body.whatsIncluded !== undefined)    updates.whatsIncluded = String(body.whatsIncluded).trim();
  if (body.price !== undefined)            updates.price = String(body.price).trim();
  if (body.currency !== undefined)         updates.currency = String(body.currency).toUpperCase().trim();
  if (body.imageUrl !== undefined)         updates.imageUrl = String(body.imageUrl).trim();
  if (body.active !== undefined)           updates.active = body.active !== false && body.active !== "false";
  if (body.soldOut !== undefined)          updates.soldOut = body.soldOut === true || body.soldOut === "true";
  if (body.stockQuantity !== undefined)    updates.stockQuantity = body.stockQuantity != null ? parseInt(String(body.stockQuantity), 10) || null : null;
  if (body.displayOrder !== undefined)     updates.displayOrder = Math.max(0, parseInt(String(body.displayOrder), 10) || 0);
  const [product] = await db
    .update(productsTable)
    .set(updates)
    .where(eq(productsTable.id, id))
    .returning();
  if (!product) return res.status(404).json({ error: "Not found" });
  await logAudit({ actorId: req.userId!, action: "product_updated", details: { productId: id } });
  return res.json({ product });
});

// Duplicate a product
router.post("/admin/products/:id/duplicate", async (req: AuthedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  const [source] = await db.select().from(productsTable).where(eq(productsTable.id, id)).limit(1);
  if (!source) return res.status(404).json({ error: "Not found" });
  const baseSlug = source.slug + "-copy";
  // Ensure unique slug
  let slug = baseSlug;
  let suffix = 1;
  while (true) {
    const [existing] = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.slug, slug)).limit(1);
    if (!existing) break;
    slug = baseSlug + "-" + (++suffix);
  }
  const maxOrder = (await db.select({ displayOrder: productsTable.displayOrder }).from(productsTable).orderBy(asc(productsTable.displayOrder))).pop()?.displayOrder ?? 0;
  const [product] = await db.insert(productsTable).values({
    name: source.name + " (Copy)",
    slug,
    shortDescription: source.shortDescription,
    description: source.description,
    whatsIncluded: source.whatsIncluded,
    price: source.price,
    currency: source.currency,
    imageUrl: source.imageUrl,
    active: false, // duplicates start inactive
    soldOut: false,
    stockQuantity: source.stockQuantity,
    displayOrder: maxOrder + 1,
  }).returning();
  await logAudit({ actorId: req.userId!, action: "product_duplicated", details: { sourceId: id, newId: product.id } });
  return res.status(201).json({ product });
});

// Request presigned upload URL for product image
router.post("/admin/products/image-upload-url", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    // Normalize to get the object path
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    return res.json({ uploadURL, objectPath });
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? "Storage error" });
  }
});

router.delete("/admin/products/:id", async (req: AuthedRequest, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  await db.delete(productsTable).where(eq(productsTable.id, id));
  await logAudit({ actorId: req.userId!, action: "product_deleted", details: { productId: id } });
  return res.json({ ok: true });
});

export default router;
