/**
 * orderSync.ts — Single source of truth for shipping-address capture from Stripe.
 *
 * This module is the ONLY place that parses Stripe shipping/customer data into
 * the order record.  It is used by:
 *   1. The checkout.session.completed webhook handler
 *   2. The "Sync from Stripe" admin endpoint
 *   3. Any future backfill / reconciliation tooling
 *
 * Never duplicate this logic in other files.
 */

import { db, ordersTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { logger } from './logger';
import type Stripe from 'stripe';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Canonical shape stored in orders.shipping_address (JSONB).
 * All fields are strings; empty string = not provided.
 */
export interface StoredShippingAddress {
  name: string;           // Recipient name (from shipping_details or customer_details)
  line1: string;          // Street address line 1
  line2: string;          // Street address line 2 / apartment
  city: string;           // Suburb / city
  state: string;          // State or territory
  postal_code: string;    // Postcode
  country: string;        // ISO 3166-1 alpha-2 (e.g. "AU")
  phone: string;          // Recipient phone (from customer_details)
  _stripeSessionId: string; // Source session ID — kept for troubleshooting
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true only if the address has at least a line1.
 * Treats null, {}, and objects without line1 as empty.
 */
export function isAddressPopulated(addr: unknown): boolean {
  if (!addr || typeof addr !== 'object') return false;
  return Boolean((addr as Record<string, unknown>).line1);
}

// ── Core extraction (pure — no DB or network I/O) ─────────────────────────────

/**
 * Extracts all shipping and customer fields from a Stripe Checkout Session.
 *
 * Compatible with Stripe API 2026-07-29+ where shipping_details and
 * customer_details are inline fields on the session object (not expandable).
 *
 * Returns null for any field that the session doesn't contain.
 */
export function extractShippingFromSession(session: Stripe.Checkout.Session): {
  customerName:    string | null;
  customerEmail:   string | null;
  customerPhone:   string | null;
  shippingAddress: StoredShippingAddress | null;
} {
  const c = session.customer_details;   // Customer info (name, email, phone)
  const s = session.shipping_details;   // Shipping destination (name, address)

  const customerName  = c?.name  ?? null;
  const customerEmail = c?.email ?? null;
  const customerPhone = c?.phone ?? null;

  // Only build a shipping address if Stripe actually collected one.
  // line1 is the minimum required field — if it's absent, we have nothing useful.
  let shippingAddress: StoredShippingAddress | null = null;
  if (s?.address?.line1) {
    shippingAddress = {
      name:            s.name ?? c?.name ?? '',
      line1:           s.address.line1             ?? '',
      line2:           s.address.line2             ?? '',
      city:            s.address.city              ?? '',
      state:           s.address.state             ?? '',
      postal_code:     s.address.postal_code       ?? '',
      country:         s.address.country           ?? '',
      phone:           c?.phone                    ?? '',
      _stripeSessionId: session.id,
    };
  }

  return { customerName, customerEmail, customerPhone, shippingAddress };
}

// ── DB write ──────────────────────────────────────────────────────────────────

/**
 * Applies a Stripe Checkout Session to an order row in the database.
 *
 * Safe-write rules:
 *  - Shipping address is written only if the session provides one AND the order
 *    doesn't already have a populated address (never overwrites with empty data).
 *  - Customer name/email/phone are filled in if currently absent on the order.
 *  - Session ID is persisted if not already stored (enables future lookups).
 *
 * Returns the updated order row.
 */
export async function applySessionToOrder(
  orderId: number,
  session: Stripe.Checkout.Session,
): Promise<typeof ordersTable.$inferSelect> {
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId))
    .limit(1);

  if (!order) throw new Error(`Order ${orderId} not found`);

  const extracted = extractShippingFromSession(session);
  const updates: Partial<typeof ordersTable.$inferInsert> = { updatedAt: new Date() };

  // Fill customer fields only when currently absent — never blank them out.
  if (extracted.customerName  && !order.customerName)  updates.customerName  = extracted.customerName;
  if (extracted.customerEmail && !order.customerEmail) updates.customerEmail = extracted.customerEmail;
  if (extracted.customerPhone && !order.customerPhone) updates.customerPhone = extracted.customerPhone;

  // Write shipping address only if the session has real data and the order doesn't.
  if (extracted.shippingAddress && !isAddressPopulated(order.shippingAddress)) {
    updates.shippingAddress = extracted.shippingAddress;
    logger.info(
      { orderId, city: extracted.shippingAddress.city, country: extracted.shippingAddress.country },
      'Shipping address captured from Stripe session'
    );
  } else if (!extracted.shippingAddress) {
    logger.warn(
      { orderId, sessionId: session.id },
      'Stripe session has no shipping_details — address not updated'
    );
  }

  // Persist session ID if not already stored.
  if (!order.stripeCheckoutSessionId && session.id) {
    updates.stripeCheckoutSessionId = session.id;
  }

  const [updated] = await db
    .update(ordersTable)
    .set(updates)
    .where(eq(ordersTable.id, orderId))
    .returning();

  return updated;
}

// ── Session resolution ────────────────────────────────────────────────────────

/**
 * Resolves the Stripe Checkout Session for an order, then applies it.
 *
 * Resolution order:
 *   1. Retrieve by stripeCheckoutSessionId (fastest path).
 *   2. If no session ID, list sessions by stripePaymentId (fallback).
 *
 * This is the single entry point for ALL shipping-address sync operations:
 *   - checkout.session.completed webhook (pass the webhook session directly
 *     if you already have it, or call this to re-fetch)
 *   - "Sync from Stripe" admin button
 *   - bulk backfill of orders with missing addresses
 *
 * NOTE: Stripe API 2026-07-29+ — shipping_details and customer_details are
 * inline on the Session object.  Do NOT pass expand parameters for these fields;
 * doing so causes a 400 error.
 */
export async function syncOrderShippingFromStripe(
  order: typeof ordersTable.$inferSelect,
  stripe: Stripe,
): Promise<typeof ordersTable.$inferSelect> {
  let session: Stripe.Checkout.Session;

  if (order.stripeCheckoutSessionId) {
    session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
  } else if (order.stripePaymentId) {
    const list = await stripe.checkout.sessions.list({
      payment_intent: order.stripePaymentId,
      limit: 1,
    });
    if (!list.data.length) {
      throw new Error(
        `No checkout session found for payment intent ${order.stripePaymentId}`
      );
    }
    session = list.data[0];
  } else {
    throw new Error(
      `Order ${order.id} has no stripeCheckoutSessionId or stripePaymentId — cannot sync`
    );
  }

  logger.info(
    {
      orderId:         order.id,
      sessionId:       session.id,
      hasShipping:     Boolean(session.shipping_details?.address?.line1),
      hasCustomer:     Boolean(session.customer_details),
    },
    'Fetched Stripe session for order sync'
  );

  return applySessionToOrder(order.id, session);
}
