import Stripe from 'stripe';
import { StripeSync } from 'stripe-replit-sync';

/**
 * Fetches Stripe credentials from the Replit connection API.
 * Not cached — tokens can rotate, so fetch fresh each time.
 */
export async function getStripeCredentials(): Promise<{ secretKey: string; publishableKey?: string }> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      'Missing Replit environment variables. ' +
      'Ensure the Stripe integration is connected via the Integrations tab.'
    );
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!resp.ok) {
    throw new Error(`Failed to fetch Stripe credentials: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  const settings = data.items?.[0]?.settings;

  // Replit Stripe connector exposes: secret, publishable, account_id
  if (!settings?.secret) {
    throw new Error(
      'Stripe integration not connected or missing secret key. ' +
      'Connect Stripe via the Integrations tab first.'
    );
  }

  return {
    secretKey:      settings.secret,
    publishableKey: settings.publishable,
  };
}

/**
 * Returns a fresh authenticated Stripe client.
 * Not cached — fetches credentials on every call so rotated keys are picked up.
 */
export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

// ---------------------------------------------------------------------------
// Cached StripeSync instance
//
// stripe-replit-sync requires that the SAME StripeSync instance that called
// findOrCreateManagedWebhook() is reused for processWebhook() calls, because
// the managed webhook secret is stored on the instance after initialization.
// ---------------------------------------------------------------------------
let _syncInstance: StripeSync | null = null;

/**
 * Returns the cached, fully-initialized StripeSync instance.
 * Must call initStripeSync() at startup before using this.
 */
export function getCachedStripeSync(): StripeSync | null {
  return _syncInstance;
}

/**
 * Creates a StripeSync instance, registers the managed webhook, and caches
 * the instance for reuse by processWebhook() calls.
 *
 * Called once at startup from index.ts. The cached instance retains the
 * webhook secret configured by findOrCreateManagedWebhook().
 */
export async function initStripeSync(databaseUrl: string, webhookUrl: string): Promise<StripeSync> {
  const { secretKey } = await getStripeCredentials();

  const sync = new StripeSync({
    poolConfig:          { connectionString: databaseUrl },
    stripeSecretKey:     secretKey,
    stripeWebhookSecret: '', // findOrCreateManagedWebhook configures this internally
  });

  await sync.findOrCreateManagedWebhook(webhookUrl);

  // Cache after webhook is configured so processWebhook() can verify signatures
  _syncInstance = sync;
  return sync;
}
