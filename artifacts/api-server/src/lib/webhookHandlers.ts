import { getCachedStripeSync, getUncachableStripeClient } from './stripeClient';
import { applySessionToOrder, syncOrderShippingFromStripe } from './orderSync';
import { db, ordersTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { logger } from './logger';
import type Stripe from 'stripe';

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

    // 1. Verify signature and sync Stripe data to stripe.* tables.
    //    stripe-replit-sync uses the webhook secret it obtained during
    //    findOrCreateManagedWebhook() to verify the signature internally.
    await sync.processWebhook(payload, signature);

    // 2. Parse the now-verified payload for our business logic.
    //    Safe to parse without re-verifying — sync.processWebhook() above
    //    would have thrown if the signature was invalid.
    let event: Stripe.Event;
    try {
      event = JSON.parse(payload.toString()) as Stripe.Event;
    } catch {
      logger.warn('Webhook payload is not valid JSON — skipping business logic');
      return;
    }

    // 3. Handle checkout completion: mark order as paid in our DB
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

    // Idempotency: skip if already marked paid
    if (order.paymentStatus === 'paid') {
      logger.info({ orderId: order.id }, 'Order already paid — skipping duplicate webhook');
      return;
    }

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? '');

    // Mark order as paid first (non-blocking — shipping sync follows)
    await db
      .update(ordersTable)
      .set({
        paymentStatus:   'paid',
        orderStatus:     'new',
        stripePaymentId: paymentIntentId,
        total:           ((session.amount_total ?? 0) / 100).toFixed(2),
        updatedAt:       new Date(),
      })
      .where(eq(ordersTable.id, order.id));

    logger.info(
      { orderId: order.id, orderNumber: order.orderNumber, paymentIntent: paymentIntentId },
      'Order marked as paid via Stripe webhook'
    );

    // Sync shipping / customer details via the shared orderSync function.
    // Re-fetch the full session from Stripe so we have the latest inline fields
    // (shipping_details, customer_details).  If the re-fetch fails, fall back to
    // the session object from the webhook payload (which also has inline fields
    // in Stripe API 2026-07-29+).
    try {
      const stripe = await getUncachableStripeClient();

      // Try fetching the full session; fall back to the webhook payload session.
      // NOTE: Do NOT pass expand params for shipping_details / customer_details —
      // in Stripe API 2026-07-29+ they are inline and cannot be expanded (400 error).
      let fullSession = session;
      try {
        fullSession = await stripe.checkout.sessions.retrieve(session.id);
      } catch (fetchErr) {
        logger.warn(
          { sessionId: session.id, err: fetchErr },
          'Could not re-fetch full session — applying shipping from webhook payload'
        );
      }

      await applySessionToOrder(order.id, fullSession);
    } catch (syncErr) {
      logger.error(
        { orderId: order.id, sessionId: session.id, err: syncErr },
        'Shipping sync failed — order is paid but address may be missing'
      );
    }
  }
}
