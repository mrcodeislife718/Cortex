import { OidcPkceClient } from './oidc-identity.js';
import { SessionSigner, StripeBillingAdapter, StripeWebhookVerifier, PostgresCommercialRepository } from './account-service.js';
import { EntitlementService, CortexPlans, quoteCortex } from './commercialization.js';
import { PostgresStateStore } from './postgres-state.js';

export class CortexCommercialRuntime {
  constructor({ oidc, sessions, stripe, webhookVerifier, repository, entitlements = new EntitlementService() } = {}) {
    if (!oidc || !sessions || !stripe || !webhookVerifier || !repository) throw new Error('commercial runtime requires identity, sessions, Stripe, webhook verification and repository');
    this.oidc = oidc;
    this.sessions = sessions;
    this.stripe = stripe;
    this.webhookVerifier = webhookVerifier;
    this.repository = repository;
    this.entitlements = entitlements;
  }

  static async fromEnvironment(env = process.env) {
    requireEnvironment(env, ['POSTGRES_URL','CORTEX_SESSION_SECRET','OIDC_ISSUER','OIDC_CLIENT_ID','OIDC_REDIRECT_URI','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET']);
    const store = await PostgresStateStore.connect({ connectionString: env.POSTGRES_URL, namespace: 'commercial' });
    await store.migrate();
    return new CortexCommercialRuntime({
      oidc: new OidcPkceClient({ issuer: env.OIDC_ISSUER, clientId: env.OIDC_CLIENT_ID, redirectUri: env.OIDC_REDIRECT_URI }),
      sessions: new SessionSigner({ secret: env.CORTEX_SESSION_SECRET }),
      stripe: new StripeBillingAdapter({ secretKey: env.STRIPE_SECRET_KEY }),
      webhookVerifier: new StripeWebhookVerifier({ secret: env.STRIPE_WEBHOOK_SECRET }),
      repository: new PostgresCommercialRepository({ pool: store.pool }),
    });
  }

  async createSession(idToken) {
    if (!idToken) throw new Error('OIDC idToken is required');
    const identity = await this.oidc.verifyIdToken(idToken);
    const token = this.sessions.issue({ subject: identity.sub, claims: { email: identity.email ?? null, name: identity.name ?? null }, ttlSeconds: 60 * 60 * 24 * 7 });
    return { token, account: { id: identity.sub, email: identity.email ?? null, name: identity.name ?? null } };
  }

  authenticate(authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(String(authorization ?? ''));
    if (!match) throw new CommercialHttpError(401, 'authentication_required');
    try { return this.sessions.verify(match[1]); }
    catch { throw new CommercialHttpError(401, 'invalid_session'); }
  }

  pricing() { return { plans: CortexPlans }; }

  async checkout({ session, plan, cadence = 'monthly', seats = 1, email = null, successUrl, cancelUrl, priceIds }) {
    const annual = cadence === 'annual';
    const quote = quoteCortex({ plan, seats, annual });
    if (plan === 'enterprise') throw new CommercialHttpError(400, 'enterprise_requires_sales');
    const priceKey = `${plan}_${annual ? 'annual' : 'monthly'}`;
    const priceId = priceIds?.[priceKey];
    if (!priceId) throw new Error(`missing Stripe price mapping: ${priceKey}`);
    const quantity = plan === 'team' ? seats : 1;
    const checkout = await this.stripe.createCheckoutSession({ customerEmail: email ?? session.email ?? null, priceId, successUrl, cancelUrl, quantity, clientReferenceId: session.sub, plan });
    return { url: checkout.url, id: checkout.id, quote };
  }

  async entitlementStatus(session) {
    const subscription = await this.repository.get(session.sub);
    const resolved = this.entitlements.resolve(subscription);
    return { accountId: session.sub, subscription, ...resolved };
  }

  async billingPortal({ session, returnUrl }) {
    const subscription = await this.repository.get(session.sub);
    if (!subscription?.providerCustomerId) throw new CommercialHttpError(404, 'billing_customer_not_found');
    const portal = await this.stripe.createBillingPortalSession({ customerId: subscription.providerCustomerId, returnUrl });
    return { url: portal.url };
  }

  async applyWebhook(rawBody, signatureHeader) {
    const event = this.webhookVerifier.verify(rawBody, signatureHeader);
    return this.repository.applyStripeEvent(event);
  }
}

export class CommercialHttpError extends Error {
  constructor(status, code, message = code) { super(message); this.name = 'CommercialHttpError'; this.status = status; this.code = code; }
}

function requireEnvironment(env, keys) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) throw new Error(`missing commercial environment: ${missing.join(', ')}`);
}
