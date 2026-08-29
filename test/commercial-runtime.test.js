import test from 'node:test';
import assert from 'node:assert/strict';
import { CortexCommercialRuntime, CommercialHttpError } from '../src/commercial-runtime.js';
import { SessionSigner } from '../src/account-service.js';

const secret = 'cortex-commercial-test-secret-32-bytes-minimum';

function runtimeFixture({ subscription = { accountId: 'acct-1', status: 'active', plan: 'pro', seats: 1, providerCustomerId: 'cus_1' } } = {}) {
  const sessions = new SessionSigner({ secret, clock: () => 1_700_000_000_000 });
  const calls = [];
  const runtime = new CortexCommercialRuntime({
    oidc: { verifyIdToken: async () => ({ sub: 'acct-1', email: 'dev@example.com', name: 'Developer' }) },
    sessions,
    stripe: {
      createCheckoutSession: async (input) => { calls.push(['checkout', input]); return { id: 'cs_1', url: 'https://checkout.example/session' }; },
      createBillingPortalSession: async (input) => { calls.push(['portal', input]); return { url: 'https://billing.example/portal' }; },
    },
    webhookVerifier: { verify: (raw, signature) => ({ id: 'evt_1', type: 'customer.subscription.updated', raw, signature }) },
    repository: { get: async () => subscription, applyStripeEvent: async (event) => ({ duplicate: false, eventId: event.id }) },
  });
  return { runtime, sessions, calls };
}

test('commercial runtime creates authenticated Cortex session and resolves paid entitlements', async () => {
  const { runtime } = runtimeFixture();
  const issued = await runtime.createSession('id-token');
  const session = runtime.authenticate(`Bearer ${issued.token}`);
  assert.equal(session.sub, 'acct-1');
  const status = await runtime.entitlementStatus(session);
  assert.equal(status.active, true);
  assert.equal(status.plan, 'pro');
  assert.ok(status.entitlements.includes('ide.desktop'));
});

test('commercial checkout uses authenticated account, configured price and plan metadata', async () => {
  const { runtime, sessions, calls } = runtimeFixture();
  const token = sessions.issue({ subject: 'acct-1', claims: { email: 'dev@example.com' }, ttlSeconds: 3600 });
  const session = runtime.authenticate(`Bearer ${token}`);
  const result = await runtime.checkout({ session, plan: 'team', cadence: 'monthly', seats: 3, successUrl: 'https://cortex.dev/success', cancelUrl: 'https://cortex.dev/cancel', priceIds: { team_monthly: 'price_team' } });
  assert.equal(result.quote.totalUsd, 447);
  assert.equal(calls[0][1].clientReferenceId, 'acct-1');
  assert.equal(calls[0][1].plan, 'team');
  assert.equal(calls[0][1].quantity, 3);
});

test('commercial runtime refuses unauthenticated entitlement and portal access', async () => {
  const { runtime } = runtimeFixture({ subscription: null });
  assert.throws(() => runtime.authenticate(''), (error) => error instanceof CommercialHttpError && error.status === 401);
  await assert.rejects(runtime.billingPortal({ session: { sub: 'acct-1' }, returnUrl: 'https://cortex.dev/account' }), (error) => error instanceof CommercialHttpError && error.status === 404);
});

test('verified Stripe webhook is handed to durable repository exactly once path', async () => {
  const { runtime } = runtimeFixture();
  const result = await runtime.applyWebhook('{"id":"evt_1"}', 't=1,v1=sig');
  assert.equal(result.duplicate, false);
  assert.equal(result.eventId, 'evt_1');
});
