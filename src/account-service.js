import crypto from 'node:crypto';

const clone = (value) => globalThis.structuredClone(value);

export class SessionSigner {
  constructor({ secret, issuer = 'cortex', audience = 'cortex-desktop', clock = () => Date.now() } = {}) {
    if (!secret || Buffer.byteLength(secret) < 32) throw new Error('session signing secret must be at least 32 bytes');
    this.secret = secret;
    this.issuer = issuer;
    this.audience = audience;
    this.clock = clock;
  }

  issue({ subject, roles = [], ttlSeconds = 3600, claims = {} }) {
    if (!subject) throw new Error('session subject is required');
    const now = Math.floor(this.clock() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = { iss: this.issuer, aud: this.audience, sub: subject, iat: now, exp: now + ttlSeconds, roles: [...new Set(roles)], ...clone(claims) };
    const body = `${encode(header)}.${encode(payload)}`;
    return `${body}.${sign(body, this.secret)}`;
  }

  verify(token) {
    const parts = String(token ?? '').split('.');
    if (parts.length !== 3) throw new Error('invalid session token');
    const body = `${parts[0]}.${parts[1]}`;
    const expected = sign(body, this.secret);
    const actual = parts[2];
    if (expected.length !== actual.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) throw new Error('invalid session signature');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const now = Math.floor(this.clock() / 1000);
    if (payload.iss !== this.issuer || payload.aud !== this.audience) throw new Error('invalid session audience');
    if (!payload.exp || payload.exp <= now) throw new Error('session expired');
    return clone(payload);
  }
}

export class DurableSubscriptionRepository {
  constructor(store) {
    if (!store || typeof store.load !== 'function' || typeof store.save !== 'function') throw new TypeError('subscription repository requires durable store');
    this.store = store;
    this.state = { schema: 'cortex.subscriptions/v1', revision: 0, subscriptions: {}, processedEvents: [] };
  }
  async open() { this.state = await this.store.load({ fallback: this.state }); validateSubscriptionState(this.state); return this; }
  get(accountId) { return clone(this.state.subscriptions[accountId] ?? null); }
  all() { return clone(this.state); }
  hasEvent(eventId) { return this.state.processedEvents.includes(eventId); }
  async applyEvent(eventId, mutation) {
    if (!eventId) throw new Error('billing event id is required');
    if (this.hasEvent(eventId)) return { duplicate: true, revision: this.state.revision };
    const next = clone(this.state);
    await mutation(next.subscriptions);
    next.processedEvents.push(eventId);
    if (next.processedEvents.length > 10_000) next.processedEvents = next.processedEvents.slice(-10_000);
    next.revision++;
    await this.store.save(next);
    this.state = next;
    return { duplicate: false, revision: next.revision };
  }
}

export class StripeBillingAdapter {
  constructor({ secretKey, fetchImpl = globalThis.fetch, apiBase = 'https://api.stripe.com/v1' } = {}) {
    if (!secretKey) throw new Error('Stripe secret key is required');
    if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
    this.secretKey = secretKey;
    this.fetchImpl = fetchImpl;
    this.apiBase = apiBase.replace(/\/$/, '');
  }

  async createCheckoutSession({ customerEmail, priceId, successUrl, cancelUrl, quantity = 1, clientReferenceId = null }) {
    if (!priceId || !successUrl || !cancelUrl) throw new Error('checkout requires priceId, successUrl and cancelUrl');
    const body = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': String(quantity),
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    if (customerEmail) body.set('customer_email', customerEmail);
    if (clientReferenceId) body.set('client_reference_id', clientReferenceId);
    return this.#request('/checkout/sessions', { method: 'POST', body });
  }

  async retrieveSubscription(subscriptionId) {
    if (!subscriptionId) throw new Error('subscription id is required');
    return this.#request(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
  }

  async createBillingPortalSession({ customerId, returnUrl }) {
    if (!customerId || !returnUrl) throw new Error('billing portal requires customerId and returnUrl');
    return this.#request('/billing_portal/sessions', { method: 'POST', body: new URLSearchParams({ customer: customerId, return_url: returnUrl }) });
  }

  async #request(path, { method = 'GET', body = null } = {}) {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.secretKey}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Stripe request failed (${response.status}): ${payload?.error?.message ?? 'unknown error'}`);
    return payload;
  }
}

export class StripeWebhookVerifier {
  constructor({ secret, toleranceSeconds = 300, clock = () => Date.now() } = {}) {
    if (!secret) throw new Error('Stripe webhook secret is required');
    this.secret = secret;
    this.toleranceSeconds = toleranceSeconds;
    this.clock = clock;
  }

  verify(rawBody, signatureHeader) {
    const parsed = parseStripeSignature(signatureHeader);
    if (!parsed.timestamp || !parsed.signatures.length) throw new Error('invalid Stripe signature header');
    const age = Math.abs(Math.floor(this.clock() / 1000) - parsed.timestamp);
    if (age > this.toleranceSeconds) throw new Error('Stripe webhook timestamp outside tolerance');
    const expected = crypto.createHmac('sha256', this.secret).update(`${parsed.timestamp}.${rawBody}`).digest('hex');
    const valid = parsed.signatures.some((candidate) => candidate.length === expected.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected)));
    if (!valid) throw new Error('invalid Stripe webhook signature');
    const event = JSON.parse(rawBody);
    if (!event?.id || !event?.type) throw new Error('invalid Stripe webhook event');
    return event;
  }
}

export class CommercialAccountService {
  constructor({ subscriptions }) {
    if (!subscriptions) throw new Error('subscription repository is required');
    this.subscriptions = subscriptions;
  }

  async applyStripeEvent(event) {
    return this.subscriptions.applyEvent(event.id, async (records) => {
      const object = event.data?.object ?? {};
      const accountId = object.metadata?.cortex_account_id ?? object.client_reference_id ?? object.customer ?? null;
      if (!accountId) return;
      if (event.type === 'customer.subscription.deleted') {
        records[accountId] = { ...(records[accountId] ?? {}), accountId, provider: 'stripe', providerSubscriptionId: object.id, status: 'cancelled', updatedAt: new Date().toISOString() };
        return;
      }
      if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
        records[accountId] = {
          accountId,
          provider: 'stripe',
          providerSubscriptionId: object.id,
          providerCustomerId: object.customer ?? null,
          status: normalizeStripeStatus(object.status),
          plan: object.metadata?.cortex_plan ?? null,
          seats: Number(object.items?.data?.[0]?.quantity ?? 1),
          currentPeriodEnd: object.current_period_end ?? null,
          updatedAt: new Date().toISOString(),
        };
      }
    });
  }
}

function parseStripeSignature(header) {
  const values = String(header ?? '').split(',').map((part) => part.trim().split('='));
  return {
    timestamp: Number(values.find(([key]) => key === 't')?.[1] ?? 0),
    signatures: values.filter(([key]) => key === 'v1').map(([, value]) => value),
  };
}

function normalizeStripeStatus(status) {
  return ['active', 'trialing'].includes(status) ? 'active' : ['past_due', 'unpaid'].includes(status) ? 'past_due' : 'inactive';
}

function validateSubscriptionState(state) {
  if (state?.schema !== 'cortex.subscriptions/v1' || !Number.isInteger(state.revision) || !state.subscriptions || !Array.isArray(state.processedEvents)) throw new Error('invalid subscription state');
}

function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function sign(body, secret) { return crypto.createHmac('sha256', secret).update(body).digest('base64url'); }
