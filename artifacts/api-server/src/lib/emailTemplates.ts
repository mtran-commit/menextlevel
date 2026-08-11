/**
 * HTML email templates — Me Next Level brand (black / white / gold).
 */

/** Escape user-controlled content before embedding in HTML. */
function esc(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface OrderEmailData {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: string;
    currency: string;
  }>;
  subtotal: string;
  shipping: string;
  total: string;
  currency: string;
  shippingAddress: {
    name?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
}

function currencySymbol(currency: string): string {
  const map: Record<string, string> = {
    AUD: 'A$', USD: '$', GBP: '£', EUR: '€', NZD: 'NZ$', CAD: 'CA$',
  };
  return map[currency.toUpperCase()] ?? currency + ' ';
}

function formatAmount(amount: string, currency: string): string {
  const sym = currencySymbol(currency);
  const num = parseFloat(amount);
  return `${sym}${num.toFixed(2)}`;
}

function shippingAddressHtml(addr: OrderEmailData['shippingAddress']): string {
  const lines = [
    esc(addr.name),
    esc(addr.line1),
    esc(addr.line2),
    [esc(addr.city), esc(addr.state), esc(addr.postal_code)].filter(Boolean).join(', '),
    esc(addr.country),
  ].filter(Boolean);
  return lines.join('<br>');
}

const BASE_STYLES = `
  body { margin: 0; padding: 0; background: #000; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; }
  table { border-collapse: collapse; }
  a { color: #c9a84c; text-decoration: none; }
`;

const GOLD = '#c9a84c';
const WHITE = '#ffffff';
const DARK_BG = '#0d0d0d';
const BORDER = '#222222';
const MUTED = '#888888';

function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Me Next Level</title>
<style>${BASE_STYLES}</style>
</head>
<body style="margin:0;padding:0;background:#000;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#000;min-height:100vh;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- HEADER -->
        <tr>
          <td style="padding:0 0 32px 0;text-align:center;">
            <span style="font-size:22px;font-weight:900;letter-spacing:0.18em;text-transform:uppercase;color:${WHITE};">ME <span style="color:${GOLD};">NEXT</span> LEVEL</span>
          </td>
        </tr>

        <!-- CONTENT -->
        ${content}

        <!-- FOOTER -->
        <tr>
          <td style="padding:32px 0 0 0;text-align:center;border-top:1px solid ${BORDER};">
            <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};">Me Next Level &copy; ${new Date().getFullYear()}</p>
            <p style="margin:0;font-size:11px;color:${MUTED};">Questions? Reply to this email or contact us at <a href="mailto:support@menextlevel.com">support</a>.</p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Customer-facing order confirmation email */
export function buildCustomerConfirmationEmail(data: OrderEmailData): string {
  const sym = currencySymbol(data.currency);

  const itemRows = data.items.map(item => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid ${BORDER};font-size:14px;color:${WHITE};">
        ${esc(item.productName)}
      </td>
      <td style="padding:12px 0;border-bottom:1px solid ${BORDER};font-size:14px;color:${MUTED};text-align:center;">
        ×${esc(String(item.quantity))}
      </td>
      <td style="padding:12px 0;border-bottom:1px solid ${BORDER};font-size:14px;color:${WHITE};text-align:right;font-weight:600;">
        ${esc(formatAmount(item.unitPrice, item.currency))}
      </td>
    </tr>
  `).join('');

  const shippingRow = parseFloat(data.shipping) > 0
    ? `<tr>
        <td colspan="2" style="padding:8px 0 4px;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};">Shipping</td>
        <td style="padding:8px 0 4px;font-size:14px;color:${WHITE};text-align:right;">${formatAmount(data.shipping, data.currency)}</td>
      </tr>`
    : `<tr>
        <td colspan="2" style="padding:8px 0 4px;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};">Shipping</td>
        <td style="padding:8px 0 4px;font-size:14px;color:${MUTED};text-align:right;">Free</td>
      </tr>`;

  const content = `
        <!-- CHECK + HEADING -->
        <tr>
          <td style="padding:0 0 32px;text-align:center;">
            <div style="width:64px;height:64px;border-radius:50%;border:2px solid ${GOLD};display:inline-flex;align-items:center;justify-content:center;margin-bottom:20px;line-height:64px;font-size:28px;color:${GOLD};">✓</div>
            <h1 style="margin:0 0 8px;font-size:28px;font-weight:900;letter-spacing:0.06em;text-transform:uppercase;color:${WHITE};">Order Confirmed</h1>
            <p style="margin:0;font-size:13px;letter-spacing:0.16em;text-transform:uppercase;color:${GOLD};">Thank you, ${esc(data.customerName.split(' ')[0])}!</p>
          </td>
        </tr>

        <!-- ORDER CARD -->
        <tr>
          <td style="background:${DARK_BG};border:1px solid ${BORDER};border-radius:4px;padding:28px 32px 24px;margin-bottom:24px;">
            <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${MUTED};">Order number</p>
            <p style="margin:0 0 24px;font-size:16px;font-weight:700;color:${GOLD};letter-spacing:0.08em;">${esc(data.orderNumber)}</p>

            <!-- Items table -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <th style="padding-bottom:8px;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:${MUTED};text-align:left;font-weight:400;">Product</th>
                <th style="padding-bottom:8px;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:${MUTED};text-align:center;font-weight:400;">Qty</th>
                <th style="padding-bottom:8px;font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:${MUTED};text-align:right;font-weight:400;">Price</th>
              </tr>
              ${itemRows}
              ${shippingRow}
              <tr>
                <td colspan="2" style="padding:16px 0 0;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};border-top:1px solid ${BORDER};">Total</td>
                <td style="padding:16px 0 0;font-size:20px;font-weight:900;color:${GOLD};text-align:right;border-top:1px solid ${BORDER};">${sym}${parseFloat(data.total).toFixed(2)} ${data.currency}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- SHIPPING ADDRESS -->
        <tr>
          <td style="padding:24px 0 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="50%" style="padding-right:12px;vertical-align:top;">
                  <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${MUTED};">Shipping to</p>
                  <p style="margin:0;font-size:13px;color:${WHITE};line-height:1.7;">${shippingAddressHtml(data.shippingAddress)}</p>
                </td>
                <td width="50%" style="padding-left:12px;vertical-align:top;">
                  <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${MUTED};">Estimated delivery</p>
                  <p style="margin:0;font-size:13px;color:${WHITE};line-height:1.7;">5–10 business days</p>
                  <p style="margin:6px 0 0;font-size:11px;color:${MUTED};">You'll receive a tracking number once your order is packed and shipped.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- SPACER -->
        <tr><td style="height:32px;"></td></tr>
  `;

  return emailWrapper(content);
}

/** Admin copy of a new order notification */
export function buildAdminOrderEmail(data: OrderEmailData): string {
  const sym = currencySymbol(data.currency);

  const itemList = data.items.map(item =>
    `• ${esc(item.productName)} ×${esc(String(item.quantity))} @ ${esc(formatAmount(item.unitPrice, item.currency))}`
  ).join('<br>');

  const addr = data.shippingAddress;
  const addrText = [addr.name, addr.line1, addr.line2, addr.city, addr.state, addr.postal_code, addr.country]
    .filter(Boolean).map(esc).join(', ');

  const content = `
        <tr>
          <td style="padding:0 0 24px;">
            <h1 style="margin:0 0 4px;font-size:22px;font-weight:900;letter-spacing:0.06em;text-transform:uppercase;color:${WHITE};">New Order Received</h1>
            <p style="margin:0;font-size:13px;color:${GOLD};letter-spacing:0.1em;text-transform:uppercase;">${esc(data.orderNumber)}</p>
          </td>
        </tr>

        <tr>
          <td style="background:${DARK_BG};border:1px solid ${BORDER};border-radius:4px;padding:24px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-bottom:16px;border-bottom:1px solid ${BORDER};">
                  <p style="margin:0 0 2px;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:${MUTED};">Customer</p>
                  <p style="margin:0;font-size:14px;color:${WHITE};">${esc(data.customerName)} &lt;${esc(data.customerEmail)}&gt;</p>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 0;border-bottom:1px solid ${BORDER};">
                  <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:${MUTED};">Items</p>
                  <p style="margin:0;font-size:13px;color:${WHITE};line-height:1.8;">${itemList}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 0;border-bottom:1px solid ${BORDER};">
                  <p style="margin:0 0 2px;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:${MUTED};">Ship to</p>
                  <p style="margin:0;font-size:13px;color:${WHITE};">${addrText || '—'}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 0 0;">
                  <p style="margin:0 0 2px;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:${MUTED};">Total charged</p>
                  <p style="margin:0;font-size:22px;font-weight:900;color:${GOLD};">${esc(sym)}${parseFloat(data.total).toFixed(2)} ${esc(data.currency)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr><td style="height:24px;"></td></tr>
  `;

  return emailWrapper(content);
}
