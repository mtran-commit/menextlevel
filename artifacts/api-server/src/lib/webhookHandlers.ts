import Stripe from 'stripe';
import { getStripeCredentials, getStripeSync } from './stripeClient';
import { db, ordersTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { logger } from './logger';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'This means express.json() ran before this webhook route. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    // 1. Verify signature and construct event for our business logic
    const { secretKey, webhookSecret } = await getStripeCredentials();
    const stripe = new Stripe(secretKey);

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret ?? '');
    } catch (err: any) {
      throw new Error(`Stripe webhook signature verification failed: ${err.message}`);
    }

    // 2. Handle our business logic
    if (event.type === 'checkout.session.completed') {
      await WebhookHandlers.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
    }

    // 3. Sync Stripe data to stripe.* tables via stripe-replit-sync
    try {
      const sync = await getStripeSync();
      await sync.processWebhook(payload, signature);
    } catch (err) {
      // Non-fatal: our order is already updated; log and continue
      logger.warn({ err }, 'stripe-replit-sync processWebhook failed (non-fatal)');
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

    const customerDetails = session.customer_details;
    const shippingDetails = session.shipping_details;

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? '');

    await db
      .update(ordersTable)
      .set({
        paymentStatus: 'paid',
        orderStatus: 'new',
        stripePaymentId: paymentIntentId,
        customerName: customerDetails?.name ?? order.customerName,
        customerEmail: customerDetails?.email ?? order.customerEmail,
        customerPhone: customerDetails?.phone ?? order.customerPhone,
        shippingAddress: shippingDetails?.address
          ? {
              name: shippingDetails.name ?? customerDetails?.name ?? '',
              line1: shippingDetails.address.line1 ?? '',
              line2: shippingDetails.address.line2 ?? '',
              city: shippingDetails.address.city ?? '',
              state: shippingDetails.address.state ?? '',
              postal_code: shippingDetails.address.postal_code ?? '',
              country: shippingDetails.address.country ?? '',
            }
          : order.shippingAddress,
        // Use actual amount charged by Stripe (reflects any taxes/discounts applied)
        total: ((session.amount_total ?? 0) / 100).toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(ordersTable.id, order.id));

    logger.info(
      { orderId: order.id, orderNumber: order.orderNumber, paymentIntent: paymentIntentId },
      'Order marked as paid via Stripe webhook'
    );
  }
}
