/**
 * Resend email client via Replit Connectors SDK.
 * Do NOT cache — tokens can rotate.
 */
import { ReplitConnectors } from '@replit/connectors-sdk';
import { logger } from './logger';

interface ResendEmailPayload {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  reply_to?: string;
  idempotencyKey?: string;
}

interface ResendResponse {
  id?: string;
  message?: string;
  name?: string;
  statusCode?: number;
}

/**
 * Send an email via Resend using the Replit Connectors SDK.
 * Throws if Resend returns a non-2xx status.
 */
export async function sendEmail(payload: ResendEmailPayload): Promise<string> {
  const connectors = new ReplitConnectors();

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (payload.idempotencyKey) {
    headers['Idempotency-Key'] = payload.idempotencyKey;
  }

  // Destructure idempotencyKey out so it isn't sent in the JSON body to Resend
  const { idempotencyKey: _key, ...resendBody } = payload;
  const response = await connectors.proxy('resend', '/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify(resendBody),
  });

  let body: ResendResponse = {};
  try {
    body = await response.json() as ResendResponse;
  } catch {
    // ignore parse errors
  }

  if (!response.ok) {
    const msg = body.message ?? `HTTP ${response.status}`;
    throw new Error(`Resend error: ${msg}`);
  }

  // Do not log recipient address — it is PII; log only the Resend message ID
  logger.info({ resendId: body.id }, 'Email sent via Resend');
  return body.id ?? '';
}
