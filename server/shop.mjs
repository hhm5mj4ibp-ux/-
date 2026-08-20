import { createHmac, timingSafeEqual } from 'node:crypto';

const STRIPE_API = 'https://api.stripe.com/v1';

export function shopConfig() {
  const secret = process.env.STRIPE_SECRET_KEY || '';
  const price = process.env.STRIPE_PRICE_PREMIUM || '';
  const enabled = !!(secret && price);
  return {
    enabled,
    priceId: enabled ? price : '',
    product: 'premium',
    amountLabel: '¥480',
  };
}

function signingSecret() {
  return process.env.SHOP_SIGNING_SECRET || process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_SECRET_KEY || 'hm-dev-sign';
}

export function signEntitlement(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', signingSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyEntitlement(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = createHmac('sha256', signingSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || payload.premium !== 1) return null;
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function issuePremiumToken(sessionId) {
  const now = Math.floor(Date.now() / 1000);
  return signEntitlement({
    premium: 1,
    sid: sessionId || '',
    iat: now,
    exp: now + 60 * 60 * 24 * 365 * 10,
  });
}

async function stripeForm(path, params) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('stripe_unconfigured');
  const body = new URLSearchParams(params);
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json?.error?.message || 'stripe_error');
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function stripeGet(path) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error('stripe_unconfigured');
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json?.error?.message || 'stripe_error');
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export async function createCheckoutSession({ successUrl, cancelUrl }) {
  const cfg = shopConfig();
  if (!cfg.enabled) {
    const err = new Error('shop_disabled');
    err.status = 503;
    throw err;
  }
  return stripeForm('/checkout/sessions', {
    mode: 'payment',
    'line_items[0][price]': cfg.priceId,
    'line_items[0][quantity]': '1',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'metadata[product]': 'premium',
  });
}

export async function retrieveCheckoutSession(sessionId) {
  if (!sessionId) return null;
  return stripeGet(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

export function sessionIsPaid(session) {
  if (!session) return false;
  return session.payment_status === 'paid' || session.status === 'complete';
}

export function verifyStripeWebhook(rawBody, header) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, error: 'no_webhook_secret' };
  if (!header) return { ok: false, error: 'no_signature' };
  const parts = Object.fromEntries(String(header).split(',').map((p) => {
    const [k, ...rest] = p.split('=');
    return [k.trim(), rest.join('=')];
  }));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return { ok: false, error: 'bad_header' };
  const signed = `${t}.${rawBody}`;
  const expect = createHmac('sha256', secret).update(signed).digest('hex');
  const a = Buffer.from(v1, 'hex');
  const b = Buffer.from(expect, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: 'bad_sig' };
  try {
    return { ok: true, event: JSON.parse(rawBody) };
  } catch {
    return { ok: false, error: 'bad_json' };
  }
}

export function successUrlFromEnv(fallbackOrigin) {
  const envUrl = process.env.SHOP_SUCCESS_URL || '';
  if (envUrl) {
    const u = new URL(envUrl);
    u.searchParams.set('shop_session', '{CHECKOUT_SESSION_ID}');
    return u.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}');
  }
  return `${fallbackOrigin}/harbin-mahjong.html?shop_session={CHECKOUT_SESSION_ID}`;
}
