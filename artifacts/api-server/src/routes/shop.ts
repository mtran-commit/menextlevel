/**
 * Shop checkout routes (public)
 *
 * POST /api/shop/create-checkout-session
 *   Body: { productId: number, quantity: number }
 *   Creates an order in PENDING state, creates a Stripe Checkout Session,
 *   and returns the Stripe-hosted payment URL. Price is always read from
 *   the database — never trusted from the browser.
 *
 * GET /api/shop/order-success?session_id=<stripe_session_id>
 *   Returns order details for the success page.
 */

import { Router, type IRouter, type Request } from "express";
import { db, ordersTable, orderItemsTable, productsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Shipping configuration ────────────────────────────────────────────────────
// Currently: free shipping. Future: read from app_config table.
const SHIPPING_AMOUNT_CENTS = 0; // 0 = free; change here or add admin config later
const SHIPPING_LABEL = SHIPPING_AMOUNT_CENTS === 0 ? "Free Shipping" : "Standard Shipping";

// Countries eligible for shipping — AU only at launch; extend this list as needed
const ALLOWED_SHIPPING_COUNTRIES: string[] = ["AU"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `MNL-${ts}-${rand}`;
}

// ── POST /api/shop/create-checkout-session ────────────────────────────────────

router.post("/shop/create-checkout-session", async (req: Request, res) => {
  try {
    const productId = parseInt(String(req.body?.productId ?? ""), 10);
    const quantity  = Math.max(1, Math.min(10, parseInt(String(req.body?.quantity ?? "1"), 10) || 1));

    if (isNaN(productId) || productId <= 0) {
      return res.status(400).json({ error: "Invalid product ID" });
    }

    // 1. Fetch product from our DB — price is authoritative here, never from browser
    const [product] = await db
      .select()
      .from(productsTable)
      .where(and(eq(productsTable.id, productId), eq(productsTable.active, true)))
      .limit(1);

    if (!product) {
      return res.status(404).json({ error: "Product not found or unavailable" });
    }
    if (product.soldOut) {
      return res.status(409).json({ error: "Product is sold out" });
    }

    // 2. Calculate amounts (in cents for Stripe, in AUD strings for our DB)
    const unitPriceCents = Math.round(parseFloat(product.price) * 100);
    if (unitPriceCents <= 0) {
      return res.status(400).json({ error: "Product price is not configured" });
    }

    const subtotalCents = unitPriceCents * quantity;
    const shippingCents = SHIPPING_AMOUNT_CENTS;
    const totalCents    = subtotalCents + shippingCents;

    const subtotal = (subtotalCents / 100).toFixed(2);
    const shipping = (shippingCents  / 100).toFixed(2);
    const total    = (totalCents     / 100).toFixed(2);
    const currency = (product.currency || "AUD").toUpperCase();

    // 3. Resolve customer email from optional Clerk session
    let customerEmail: string | undefined;
    const clerkUserId = (req as any).auth?.userId ?? null;
    if (clerkUserId) {
      try {
        const [user] = await db
          .select({ email: usersTable.email })
          .from(usersTable)
          .where(eq(usersTable.id, clerkUserId))
          .limit(1);
        if (user?.email) customerEmail = user.email;
      } catch (_) { /* non-fatal */ }
    }

    // 4. Create order in DB with PENDING payment status
    const orderNumber = generateOrderNumber();
    const [order] = await db
      .insert(ordersTable)
      .values({
        orderNumber,
        userId:         clerkUserId ?? null,
        customerName:   "",  // filled by webhook after payment
        customerEmail:  customerEmail ?? "",
        customerPhone:  "",
        shippingAddress: {},
        subtotal,
        shipping,
        total,
        currency,
        paymentStatus: "pending",
        orderStatus:   "new",
        stripePaymentId:        "",
        stripeCheckoutSessionId: "",  // filled below once session is created
        trackingNumber: "",
        courier:        "",
        adminNotes:     "",
      })
      .returning();

    // 5. Build the Stripe Checkout Session
    const stripe = await getUncachableStripeClient();

    // Detect public base URL for redirect URLs
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0] ?? req.get("host") ?? "localhost";
    const baseUrl = `https://${domain}`;

    // Include image if we have one (Stripe follows redirects)
    const imageUrl = product.imageUrl ? `${baseUrl}${product.imageUrl}` : undefined;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: unitPriceCents,
            product_data: {
              name:        product.name,
              description: product.shortDescription || undefined,
              ...(imageUrl ? { images: [imageUrl] } : {}),
            },
          },
          quantity,
        },
      ],

      // Collect shipping address — AU only at launch; add more countries here later
      shipping_address_collection: {
        allowed_countries: ALLOWED_SHIPPING_COUNTRIES as any[],
      },

      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: {
              amount:   shippingCents,
              currency: currency.toLowerCase(),
            },
            display_name: SHIPPING_LABEL,
            delivery_estimate: {
              minimum: { unit: "business_day", value: 5 },
              maximum: { unit: "business_day", value: 10 },
            },
          },
        },
      ],

      // Collect phone for delivery
      phone_number_collection: { enabled: true },

      // Pre-fill email if user is logged in
      ...(customerEmail ? { customer_email: customerEmail } : {}),

      // Structured for Stripe Tax enablement — set enabled: true in Stripe Dashboard when ready
      automatic_tax: { enabled: false },

      // Order metadata for webhook lookup
      metadata: {
        orderId:     String(order.id),
        orderNumber,
        productId:   String(product.id),
        productName: product.name,
      },

      success_url: `${baseUrl}/shop/order-success/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${baseUrl}/shop/`,
    });

    // 6. Persist the session ID for idempotent webhook lookup
    await db
      .update(ordersTable)
      .set({ stripeCheckoutSessionId: session.id })
      .where(eq(ordersTable.id, order.id));

    // 7. Persist order items
    await db.insert(orderItemsTable).values({
      orderId:     order.id,
      productId:   product.id,
      productName: product.name,
      productSlug: product.slug,
      quantity,
      unitPrice:   product.price,
      currency,
    });

    logger.info(
      { orderId: order.id, orderNumber, sessionId: session.id, total },
      "Stripe Checkout Session created"
    );

    return res.json({ url: session.url });
  } catch (err: any) {
    logger.error({ err }, "create-checkout-session failed");
    return res.status(500).json({ error: err.message ?? "Checkout creation failed" });
  }
});

// ── GET /api/shop/order-success ───────────────────────────────────────────────

router.get("/shop/order-success", async (req: Request, res) => {
  const sessionId = String(req.query?.session_id ?? "").trim();

  if (!sessionId || !sessionId.startsWith("cs_")) {
    return res.status(400).json({ error: "Missing or invalid session_id" });
  }

  try {
    const [order] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.stripeCheckoutSessionId, sessionId))
      .limit(1);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const items = await db
      .select()
      .from(orderItemsTable)
      .where(eq(orderItemsTable.orderId, order.id));

    return res.json({ order: { ...order, items } });
  } catch (err: any) {
    logger.error({ err }, "order-success lookup failed");
    return res.status(500).json({ error: "Failed to retrieve order" });
  }
});

export default router;
