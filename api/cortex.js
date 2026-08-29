import { CortexCommercialRuntime, CommercialHttpError } from '../src/commercial-runtime.js';

let runtimePromise = null;

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  const origin = String(req.headers.origin ?? '');
  applyCors(res, origin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const action = String(req.query?.action ?? 'health');
    if (action === 'health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'cortex-commercial' });
    const runtime = await getRuntime();
    if (action === 'pricing' && req.method === 'GET') return json(res, 200, runtime.pricing());
    if (action === 'session' && req.method === 'POST') {
      const body = await parseJson(req);
      return json(res, 200, await runtime.createSession(body.idToken));
    }
    if (action === 'webhook' && req.method === 'POST') {
      const raw = await readRawBody(req);
      const result = await runtime.applyWebhook(raw.toString('utf8'), req.headers['stripe-signature']);
      return json(res, 200, { received: true, ...result });
    }
    const session = runtime.authenticate(req.headers.authorization);
    if (action === 'entitlements' && req.method === 'GET') return json(res, 200, await runtime.entitlementStatus(session));
    if (action === 'checkout' && req.method === 'POST') {
      const body = await parseJson(req);
      const appUrl = requiredEnv('CORTEX_APP_URL').replace(/\/$/, '');
      const priceIds = {
        pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
        pro_annual: process.env.STRIPE_PRICE_PRO_ANNUAL,
        team_monthly: process.env.STRIPE_PRICE_TEAM_MONTHLY,
        team_annual: process.env.STRIPE_PRICE_TEAM_ANNUAL,
      };
      return json(res, 200, await runtime.checkout({ session, plan: body.plan, cadence: body.cadence, seats: body.seats, email: body.email, successUrl: `${appUrl}/billing/success`, cancelUrl: `${appUrl}/billing/cancelled`, priceIds }));
    }
    if (action === 'portal' && req.method === 'POST') {
      const appUrl = requiredEnv('CORTEX_APP_URL').replace(/\/$/, '');
      return json(res, 200, await runtime.billingPortal({ session, returnUrl: `${appUrl}/account` }));
    }
    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    const status = error instanceof CommercialHttpError ? error.status : 500;
    const code = error instanceof CommercialHttpError ? error.code : 'internal_error';
    if (status >= 500) console.error('cortex-commercial', error);
    return json(res, status, { error: code });
  }
}

async function getRuntime() {
  runtimePromise ??= CortexCommercialRuntime.fromEnvironment();
  return runtimePromise;
}

async function readRawBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1024 * 1024) throw new CommercialHttpError(413, 'body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function parseJson(req) {
  const raw = await readRawBody(req);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); }
  catch { throw new CommercialHttpError(400, 'invalid_json'); }
}

function applyCors(res, origin) {
  const allowed = String(process.env.CORTEX_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, stripe-signature');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function json(res, status, payload) { return res.status(status).json(payload); }
function requiredEnv(name) { const value = process.env[name]; if (!value) throw new Error(`missing ${name}`); return value; }
