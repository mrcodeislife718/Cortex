import test from 'node:test';
import assert from 'node:assert/strict';
import { CortexCommercialRuntime, CommercialHttpError } from '../src/commercial-runtime.js';
import { SessionSigner } from '../src/account-service.js';
import { ModelRuntime } from '../src/model-runtime.js';
import { validateCommercialCatalog } from '../src/commercialization.js';

const secret = 'cortex-commercial-test-secret-32-bytes-minimum';
const catalog = validateCommercialCatalog({
  currency: 'USD',
  plans: {
    pro: { monthly: 7900, annual: 79000 },
    team: { monthly: 14900, annual: 149000 },
    enterprise: { annualMinimum: 5000000 },
  },
});

function runtimeFixture({
  subscription = { accountId: 'acct-1', status: 'active', plan: 'pro', seats: 1, providerCustomerId: 'cus_1' },
  monthlySpend = 0,
  monthlyBudget = undefined,
} = {}) {
  const sessions = new SessionSigner({ secret, clock: () => 1_700_000_000_000 });
  const calls = [];
  const usage = [];
  let activation = null;
  const repository = {
    get: async () => subscription,
    applyStripeEvent: async (event) => ({ duplicate: false, eventId: event.id }),
    createActivation: async (accountId, { ttlSeconds }) => { activation = { code: 'activation-code-012345678901234567890', accountId, ttlSeconds }; return { code: activation.code, expiresIn: ttlSeconds }; },
    redeemActivation: async (code) => code === activation?.code ? activation.accountId : null,
    usageSince: async () => monthlySpend + usage.filter((event) => event.metric === 'model.usd').reduce((sum, event) => sum + event.quantity, 0),
    recordUsage: async (event) => { usage.push(event); return event; },
  };
  const modelRuntime = new ModelRuntime({ sleep: async () => {} });
  modelRuntime.register('openai', { generate: async () => ({ text: 'Cortex answer', usage: { inputTokens: 1000, outputTokens: 500 } }) }, { usdPer1MInput: 4, usdPer1MOutput: 20, hosted: true });
  const runtime = new CortexCommercialRuntime({
    oidc: { verifyIdToken: async () => ({ sub: 'acct-1', email: 'dev@example.com', name: 'Developer' }) },
    sessions,
    stripe: {
      createCheckoutSession: async (input) => { calls.push(['checkout', input]); return { id: 'cs_1', url: 'https://checkout.example/session' }; },
      createBillingPortalSession: async (input) => { calls.push(['portal', input]); return { url: 'https://billing.example/portal' }; },
    },
    webhookVerifier: { verify: (raw, signature) => ({ id: 'evt_1', type: 'customer.subscription.updated', raw, signature }) },
    repository,
    modelRuntime,
    commercialConfig: { catalog, modelPreference: ['openai'], perRequestBudgetUsd: 5, monthlyAiBudgetByPlan: { pro: monthlyBudget } },
  });
  return { runtime, sessions, calls, usage, repository };
}

test('commercial catalog validates minor-unit amounts and fails closed when malformed', () => {
  assert.equal(catalog.plans.pro.monthly, 7900);
  assert.throws(() => validateCommercialCatalog({ currency: 'USD', plans: { pro: { monthly: 1, annual: 1 } } }), /missing team/);
  assert.throws(() => validateCommercialCatalog({ currency: 'US', plans: {} }), /three-letter currency/);
});

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
  assert.equal(result.quote.totalAmount, 44700);
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

test('desktop activation requires entitlement and redeems as a one-time paid desktop session', async () => {
  const { runtime, sessions } = runtimeFixture();
  const token = sessions.issue({ subject: 'acct-1', ttlSeconds: 3600 });
  const session = runtime.authenticate(`Bearer ${token}`);
  const activation = await runtime.createDesktopActivation(session);
  assert.ok(activation.code.length >= 20);
  const redeemed = await runtime.redeemDesktopActivation(activation.code);
  const desktop = runtime.authenticate(`Bearer ${redeemed.token}`);
  assert.equal(desktop.sub, 'acct-1');
  assert.equal(desktop.desktop, true);
  await assert.rejects(runtime.redeemDesktopActivation('wrong-activation-code-012345678901'), (error) => error instanceof CommercialHttpError && error.status === 401);
});

test('hosted assistant records durable account spend requests and token usage', async () => {
  const { runtime, usage } = runtimeFixture();
  const result = await runtime.assistant({ session: { sub: 'acct-1' }, input: 'Explain this repository', context: [{ source: 'current-editor', text: 'export const value = 1;' }] });
  assert.equal(result.provider, 'openai');
  assert.equal(result.result, 'Cortex answer');
  assert.equal(result.costUsd, 0.014);
  assert.equal(usage.find((event) => event.metric === 'model.usd').quantity, 0.014);
  assert.equal(usage.find((event) => event.metric === 'model.requests').quantity, 1);
  assert.equal(usage.find((event) => event.metric === 'model.input_tokens').quantity, 1000);
  assert.equal(usage.find((event) => event.metric === 'model.output_tokens').quantity, 500);
});

test('monthly AI budget is enforced separately from the per-request model budget', async () => {
  const { runtime } = runtimeFixture({ monthlySpend: 9.99, monthlyBudget: 10 });
  await assert.rejects(runtime.assistant({ session: { sub: 'acct-1' }, input: 'Explain this repository' }), (error) => error instanceof AggregateError || (error instanceof CommercialHttpError && error.status === 429));

  const exhausted = runtimeFixture({ monthlySpend: 10, monthlyBudget: 10 }).runtime;
  await assert.rejects(exhausted.assistant({ session: { sub: 'acct-1' }, input: 'Explain this repository' }), (error) => error instanceof CommercialHttpError && error.code === 'monthly_ai_budget_exhausted');
});

test('high-risk assistant objectives require approval before any hosted model cost is incurred', async () => {
  const { runtime, usage } = runtimeFixture();
  const result = await runtime.assistant({ session: { sub: 'acct-1' }, input: 'Deploy this to production' });
  assert.equal(result.status, 'approval-required');
  assert.equal(usage.length, 0);
});
