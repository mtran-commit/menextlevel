import { getCachedStripeSync } from './stripeClient';
import { db, ordersTable, orderItemsTable } from '@workspace/db';
import { eq, and, lt, lte, gte, or } from 'drizzle-orm';
import { logger } from './logger';
import { sendEmail } from './emailClient';
import { buildCustomerConfirmationEmail, buildAdminOrderEmail, type OrderEmailData } from './emailTemplates';
import type Stripe from 'stripe';

// Max attempts before giving up on delivery
const MAX_EMAIL_ATTEMPTS = 5;

// Lease duration: if a worker holds `in_flight` longer than this, it crashed
const LEASE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

// Minimum back-off before the sweeper retries a `pending` row (attempt 0-indexed)
function retryDelayMinutes(attempt: number): number {
  return 5 * Math.pow(2, attempt); // 5, 10, 20, 40, 80 min
}

// shipping_details exists on Checkout.Session but is absent from older Stripe
// type declaration bundles; access via a typed intersection to keep strict TS.
type SessionWithShipping = Stripe.Checkout.Session & {
  shipping_details?: {
    name?: string | null;
    address?: {
      line1?: string | null;
      line2?: string | null;
      city?: string | null;
      state?: string | null;
      postal_code?: string | null;
      country?: string | null;
    } | null;
  } | null;
};

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'This means express.json() ran before this webhook route. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = getCachedStripeSync();
    if (!sync) {
      throw new Error(
        'StripeSync not initialized. ' +
        'Ensure initStripeSync() has been called at startup.'
      );
    }

    await sync.processWebhook(payload, signature);

    let event: Stripe.Event;
    try {
      event = JSON.parse(payload.toString()) as Stripe.Event;
    } catch {
      logger.warn('Webhook payload is not valid JSON — skipping business logic');
      return;
    }

    if (event.type === 'checkout.session.completed') {
      await WebhookHandlers.handleCheckoutCompleted(
        event.data.object as Stripe.Checkout.Session
      );
    }
  }

  private static async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const [order] = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.stripeCheckoutSessionId, session.id))
      .limit(1);

    if (!order) {
      logger.error({ sessionId: session.id }, 'No order found for completed Stripe checkout session');
      return;
    }

    const customerDetails = session.customer_details;
    const shippingDetails = (session as SessionWithShipping).shipping_details ?? null;

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? '');

    // Idempotency: if already marked paid, just ensure email delivery
    if (order.paymentStatus === 'paid') {
      logger.info({ orderId: order.id }, 'Order already paid — ensuring customer email delivery');
      await WebhookHandlers.attemptCustomerEmailDelivery(order);
      return;
    }

    const updatedShippingAddress = shippingDetails?.address
      ? {
          name:        shippingDetails.name ?? customerDetails?.name ?? '',
          line1:       shippingDetails.address.line1        ?? '',
          line2:       shippingDetails.address.line2        ?? '',
          city:        shippingDetails.address.city         ?? '',
          state:       shippingDetails.address.state        ?? '',
          postal_code: shippingDetails.address.postal_code  ?? '',
          country:     shippingDetails.address.country      ?? '',
        }
      : (order.shippingAddress as OrderEmailData['shippingAddress']);

    const updatedCustomerName  = customerDetails?.name  ?? order.customerName;
    const updatedCustomerEmail = customerDetails?.email ?? order.customerEmail;
    const updatedTotal         = ((session.amount_total ?? 0) / 100).toFixed(2);

    // Mark paid and initialise email delivery state atomically
    const [updatedOrder] = await db
      .update(ordersTable)
      .set({
        paymentStatus:             'paid',
        orderStatus:               'new',
        stripePaymentId:           paymentIntentId,
        customerName:              updatedCustomerName,
        customerEmail:             updatedCustomerEmail,
        customerPhone:             customerDetails?.phone ?? order.customerPhone,
        shippingAddress:           updatedShippingAddress,
        total:                     updatedTotal,
        confirmationEmailStatus:   'pending',
        confirmationEmailAttempts: 0,
        updatedAt:                 new Date(),
      })
      .where(eq(ordersTable.id, order.id))
      .returning();

    logger.info(
      { orderId: order.id, orderNumber: order.orderNumber, paymentIntent: paymentIntentId },
      'Order marked as paid via Stripe webhook'
    );

    if (updatedOrder) {
      await WebhookHandlers.attemptCustomerEmailDelivery(updatedOrder);
    }
  }

  /**
   * Attempt to acquire a lease and deliver the customer confirmation email.
   *
   * Concurrency model — lease-based serialisation:
   *   pending   → in_flight  (atomic UPDATE … WHERE status='pending'; only one worker wins)
   *   in_flight → sent       (on successful send + DB persist)
   *   in_flight → pending    (on send failure, if attempts < MAX, for sweeper retry)
   *   in_flight → failed     (on send failure at MAX attempts)
   *
   * A stable Resend idempotency key (`mnl-order-{id}-customer`) ensures that if
   * the process crashes after Resend accepts the request but before we persist
   * `sent`, the next retry re-uses the same key and Resend deduplicates.
   *
   * Admin notification is fire-and-forget and does not affect delivery state.
   */
  static async attemptCustomerEmailDelivery(
    order: typeof ordersTable.$inferSelect
  ): Promise<void> {
    // Skip terminal / pre-feature states
    if (
      order.confirmationEmailStatus === 'sent' ||
      order.confirmationEmailStatus === 'failed' ||
      order.confirmationEmailStatus === null
    ) {
      return;
    }

    // Only attempt if status is 'pending' (or an expired 'in_flight' lease).
    // The sweeper resets expired leases back to 'pending' before calling here,
    // so by the time we arrive the status should be 'pending'.
    if (order.confirmationEmailStatus !== 'pending') {
      return;
    }

    const currentAttempts = order.confirmationEmailAttempts ?? 0;

    // Guard: if already at max, mark failed and exit (handles crash-at-max edge case)
    if (currentAttempts >= MAX_EMAIL_ATTEMPTS) {
      await db.update(ordersTable)
        .set({ confirmationEmailStatus: 'failed', updatedAt: new Date() })
        .where(
          and(
            eq(ordersTable.id, order.id),
            eq(ordersTable.confirmationEmailStatus, 'pending')
          )
        );
      logger.error({ orderId: order.id, attempts: currentAttempts }, 'Customer email permanently failed — max attempts reached');
      return;
    }

    // ── Atomic lease acquisition ──────────────────────────────────────────────
    // Transition status FROM 'pending' TO 'in_flight' in one statement.
    // Only the row whose status is still 'pending' will be updated; any
    // concurrent worker will get 0 rows back and bail out.
    const now = new Date();
    const nextAttempts = currentAttempts + 1;

    const [leased] = await db.update(ordersTable)
      .set({
        confirmationEmailStatus:   'in_flight',
        confirmationEmailLockedAt: now,
        confirmationEmailAttempts: nextAttempts,
        updatedAt:                 now,
      })
      .where(
        and(
          eq(ordersTable.id, order.id),
          eq(ordersTable.confirmationEmailStatus, 'pending')
        )
      )
      .returning();

    if (!leased) {
      // Another process already claimed this order — do nothing
      logger.debug({ orderId: order.id }, 'Customer email lease already held by another worker — skipping');
      return;
    }

    // The exact timestamp the DB stored for our lease — used as the lease token
    // in all subsequent writes so a stale worker cannot overwrite a new lease.
    const leaseToken = leased.confirmationEmailLockedAt!;

    // ── Fetch order data for the templates ────────────────────────────────────
    const items = await db
      .select()
      .from(orderItemsTable)
      .where(eq(orderItemsTable.orderId, order.id));

    const emailData: OrderEmailData = {
      orderNumber:     leased.orderNumber,
      customerName:    leased.customerName,
      customerEmail:   leased.customerEmail,
      items:           items.map(i => ({
        productName: i.productName,
        quantity:    i.quantity,
        unitPrice:   i.unitPrice,
        currency:    i.currency,
      })),
      subtotal:        leased.subtotal,
      shipping:        leased.shipping,
      total:           leased.total,
      currency:        leased.currency,
      shippingAddress: leased.shippingAddress as OrderEmailData['shippingAddress'],
    };

    const fromAddress = 'Me Next Level <orders@menextlevel.com>';
    const adminEmail  = process.env.ADMIN_EMAIL ?? '';

    // Stable key: same per order regardless of attempt number.
    // Resend deduplicates if it accepted a previous request that we failed to persist.
    const customerIdempKey = `mnl-order-${leased.id}-customer`;

    // Helper: write a final state only while we still hold the lease.
    // Returns true if the write landed, false if the sweeper recovered the lease first.
    type OrderUpdate = Parameters<ReturnType<typeof db.update<typeof ordersTable>>['set']>[0];
    async function writeWithLease(fields: OrderUpdate): Promise<boolean> {
      const rows = await db.update(ordersTable)
        .set(fields)
        .where(
          and(
            eq(ordersTable.id, leased.id),
            eq(ordersTable.confirmationEmailLockedAt, leaseToken)
          )
        )
        .returning({ id: ordersTable.id });
      return rows.length > 0;
    }

    // ── Send customer confirmation ─────────────────────────────────────────────
    try {
      await sendEmail({
        from:           fromAddress,
        to:             leased.customerEmail,
        subject:        `Order Confirmed — ${leased.orderNumber}`,
        html:           buildCustomerConfirmationEmail(emailData),
        idempotencyKey: customerIdempKey,
      });

      // Durably record success — guarded by lease token so a stale write is a no-op
      const committed = await writeWithLease({
        confirmationEmailStatus:   'sent',
        confirmationEmailSentAt:   new Date(),
        confirmationEmailLockedAt: null,
        updatedAt:                 new Date(),
      });

      if (committed) {
        logger.info({ orderId: leased.id, orderNumber: leased.orderNumber }, 'Customer confirmation email sent');
      } else {
        // Lease was recovered while we were sending — Resend idempotency key
        // ensures no duplicate was delivered; the new owner will also write 'sent'.
        logger.warn({ orderId: leased.id }, 'Lease expired before sent status could be persisted — Resend idempotency key prevents duplicate');
      }

    } catch (err) {
      // Release the lease back to pending (or fail if at max) — guarded by token
      const finalStatus = nextAttempts >= MAX_EMAIL_ATTEMPTS ? 'failed' : 'pending';
      const committed = await writeWithLease({
        confirmationEmailStatus:   finalStatus,
        confirmationEmailLockedAt: null,
        updatedAt:                 new Date(),
      });
      if (!committed) {
        logger.debug({ orderId: leased.id }, 'Lease expired before failure status could be persisted — sweeper will recover');
      }
      logger.error(
        { err, orderId: leased.id, attempts: nextAttempts, status: finalStatus },
        'Customer confirmation email send failed'
      );
      return; // Don't attempt admin notify when customer send failed
    }

    // ── Admin notification (fire-and-forget, independent of customer status) ───
    if (adminEmail) {
      const adminIdempKey = `mnl-order-${leased.id}-admin`;
      sendEmail({
        from:           fromAddress,
        to:             adminEmail,
        subject:        `New Order — ${leased.orderNumber} — ${leased.customerName}`,
        html:           buildAdminOrderEmail(emailData),
        reply_to:       leased.customerEmail || undefined,
        idempotencyKey: adminIdempKey,
      }).catch(err => {
        logger.warn({ err, orderId: leased.id }, 'Admin order notification failed (non-critical)');
      });
    }
  }

  /**
   * Background sweeper — runs every 5 minutes.
   *
   * Three jobs:
   *  1. Recover expired in_flight leases (worker crashed) → back to pending
   *  2. Mark pending/in_flight rows at max-attempt cap → failed
   *     (handles crash-at-max where status never reached 'failed')
   *  3. Retry eligible pending rows (respecting exponential back-off)
   */
  static async retryPendingEmails(): Promise<void> {
    const now   = new Date();
    const leaseExpiry = new Date(now.getTime() - LEASE_DURATION_MS);

    // ── 1. Recover expired leases ─────────────────────────────────────────────
    const recovered = await db.update(ordersTable)
      .set({ confirmationEmailStatus: 'pending', confirmationEmailLockedAt: null, updatedAt: now })
      .where(
        and(
          eq(ordersTable.confirmationEmailStatus, 'in_flight'),
          lte(ordersTable.confirmationEmailLockedAt, leaseExpiry)
        )
      )
      .returning({ id: ordersTable.id });

    if (recovered.length > 0) {
      logger.info({ ids: recovered.map(r => r.id) }, 'Sweeper: recovered expired in_flight leases');
    }

    // ── 2. Mark crash-at-max pending rows as failed ───────────────────────────
    // After step 1 resets expired in_flight→pending, any remaining pending rows
    // with attempts >= MAX were never successfully sent. Mark them failed.
    await db.update(ordersTable)
      .set({ confirmationEmailStatus: 'failed', updatedAt: now })
      .where(
        and(
          eq(ordersTable.confirmationEmailStatus, 'pending'),
          gte(ordersTable.confirmationEmailAttempts, MAX_EMAIL_ATTEMPTS)
        )
      );

    // ── 3. Retry eligible pending rows ────────────────────────────────────────
    const pending = await db
      .select()
      .from(ordersTable)
      .where(
        and(
          eq(ordersTable.confirmationEmailStatus, 'pending'),
          lt(ordersTable.confirmationEmailAttempts, MAX_EMAIL_ATTEMPTS)
        )
      );

    for (const order of pending) {
      const attempts   = order.confirmationEmailAttempts ?? 0;
      const delayMs    = retryDelayMinutes(attempts) * 60 * 1000;
      const eligibleAt = new Date(order.updatedAt.getTime() + delayMs);

      if (now >= eligibleAt) {
        logger.info({ orderId: order.id, attempts }, 'Sweeper: retrying pending customer confirmation email');
        WebhookHandlers.attemptCustomerEmailDelivery(order).catch(err => {
          logger.warn({ err, orderId: order.id }, 'Sweeper: unexpected error during retry');
        });
      }
    }
  }
}
