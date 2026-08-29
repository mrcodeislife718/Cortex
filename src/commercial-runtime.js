import { OidcPkceClient } from './oidc-identity.js';
import { SessionSigner, StripeBillingAdapter, StripeWebhookVerifier, PostgresCommercialRepository } from './account-service.js';
import { EntitlementService, CortexPlans, quoteCortex } from './commercialization.js';
import { PostgresStateStore } from './postgres-state.js';
import { ModelRuntime } from './model-runtime.js';
import { OpenAIResponsesProvider, AnthropicMessagesProvider, GeminiInteractionsProvider } from './model-providers.js';
import { AssistantOrchestrator } from './assistant-orchestrator.js';
import { PromptBoundary } from './security-kernel.js';

export class CortexCommercialRuntime {
  constructor({ oidc, sessions, stripe, webhookVerifier, repository, entitlements = new EntitlementService(), modelRuntime = null, orchestrator = new AssistantOrchestrator(), promptBoundary = new PromptBoundary() } = {}) {
    if (!oidc || !sessions || !stripe || !webhookVerifier || !repository) throw new Error('commercial runtime requires identity, sessions, Stripe, webhook verification and repository');
    this.oidc = oidc; this.sessions = sessions; this.stripe = stripe; this.webhookVerifier = webhookVerifier; this.repository = repository; this.entitlements = entitlements; this.modelRuntime = modelRuntime; this.orchestrator = orchestrator; this.promptBoundary = promptBoundary;
  }
  static async fromEnvironment(env = process.env) {
    requireEnvironment(env, ['POSTGRES_URL','CORTEX_SESSION_SECRET','OIDC_ISSUER','OIDC_CLIENT_ID','OIDC_REDIRECT_URI','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET']);
    const store = await PostgresStateStore.connect({ connectionString: env.POSTGRES_URL, namespace: 'commercial' });
    await store.migrate();
    const modelRuntime = buildModelRuntime(env);
    return new CortexCommercialRuntime({ oidc: new OidcPkceClient({ issuer: env.OIDC_ISSUER, clientId: env.OIDC_CLIENT_ID, redirectUri: env.OIDC_REDIRECT_URI }), sessions: new SessionSigner({ secret: env.CORTEX_SESSION_SECRET }), stripe: new StripeBillingAdapter({ secretKey: env.STRIPE_SECRET_KEY }), webhookVerifier: new StripeWebhookVerifier({ secret: env.STRIPE_WEBHOOK_SECRET }), repository: new PostgresCommercialRepository({ pool: store.pool }), modelRuntime });
  }
  async createSession(idToken, { nonce = null } = {}) {
    if (!idToken) throw new Error('OIDC idToken is required');
    const identity = await this.oidc.verifyIdToken(idToken, { nonce });
    return this.#issueSession(identity.sub, { email: identity.email ?? null, name: identity.name ?? null });
  }
  authenticate(authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(String(authorization ?? ''));
    if (!match) throw new CommercialHttpError(401, 'authentication_required');
    try { return this.sessions.verify(match[1]); } catch { throw new CommercialHttpError(401, 'invalid_session'); }
  }
  pricing() { return { plans: CortexPlans }; }
  async checkout({ session, plan, cadence = 'monthly', seats = 1, email = null, successUrl, cancelUrl, priceIds }) {
    const annual = cadence === 'annual'; const quote = quoteCortex({ plan, seats, annual });
    if (plan === 'enterprise') throw new CommercialHttpError(400, 'enterprise_requires_sales');
    const priceKey = `${plan}_${annual ? 'annual' : 'monthly'}`; const priceId = priceIds?.[priceKey]; if (!priceId) throw new Error(`missing Stripe price mapping: ${priceKey}`);
    const quantity = plan === 'team' ? seats : 1;
    const checkout = await this.stripe.createCheckoutSession({ customerEmail: email ?? session.email ?? null, priceId, successUrl, cancelUrl, quantity, clientReferenceId: session.sub, plan });
    return { url: checkout.url, id: checkout.id, quote };
  }
  async entitlementStatus(session) {
    const subscription = await this.repository.get(session.sub); const resolved = this.entitlements.resolve(subscription);
    return { accountId: session.sub, subscription, ...resolved };
  }
  async billingPortal({ session, returnUrl }) {
    const subscription = await this.repository.get(session.sub); if (!subscription?.providerCustomerId) throw new CommercialHttpError(404, 'billing_customer_not_found');
    const portal = await this.stripe.createBillingPortalSession({ customerId: subscription.providerCustomerId, returnUrl }); return { url: portal.url };
  }
  async createDesktopActivation(session) {
    const status = await this.entitlementStatus(session);
    if (!status.active || !this.entitlements.allows(status.subscription, 'ide.desktop')) throw new CommercialHttpError(402, 'desktop_entitlement_required');
    return this.repository.createActivation(session.sub, { ttlSeconds: 600 });
  }
  async redeemDesktopActivation(code) {
    const accountId = await this.repository.redeemActivation(code);
    if (!accountId) throw new CommercialHttpError(401, 'invalid_activation_code');
    const subscription = await this.repository.get(accountId);
    if (!this.entitlements.allows(subscription, 'ide.desktop')) throw new CommercialHttpError(402, 'desktop_entitlement_required');
    return this.#issueSession(accountId, { plan: subscription.plan, desktop: true });
  }
  async assistant({ session, input, context = [], budgetUsd = 2 }) {
    const subscription = await this.repository.get(session.sub);
    if (!this.entitlements.allows(subscription, 'ai.hosted')) throw new CommercialHttpError(402, 'hosted_ai_entitlement_required');
    if (!this.modelRuntime?.providers?.size) throw new CommercialHttpError(503, 'model_provider_unavailable');
    const goal = String(input ?? '').trim();
    if (!goal || goal.length > 20_000) throw new CommercialHttpError(400, 'invalid_assistant_input');
    const safeContext = normalizeAssistantContext(context);
    const route = this.orchestrator.route(goal);
    if (route.requiresApproval) return { status: 'approval-required', route };
    const compiledContext = this.promptBoundary.compile([{ source: 'user', text: goal }, ...safeContext]);
    const preferred = String(process.env.CORTEX_MODEL_PREFERENCE ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    const result = await this.modelRuntime.generate({ input: goal, route, context: compiledContext }, { preferred, accountId: session.sub, budgetUsd: Math.min(Number(budgetUsd) || 2, 5), retries: 1 });
    return { status: route.requiresVerification ? 'verification-required' : 'completed', route, provider: result.provider, costUsd: result.costUsd, result: result.result?.text ?? result.result };
  }
  async applyWebhook(rawBody, signatureHeader) { const event = this.webhookVerifier.verify(rawBody, signatureHeader); return this.repository.applyStripeEvent(event); }
  #issueSession(subject, claims = {}) { const token = this.sessions.issue({ subject, claims, ttlSeconds: 60 * 60 * 24 * 30 }); return { token, account: { id: subject, ...claims } }; }
}

export class CommercialHttpError extends Error { constructor(status, code, message = code) { super(message); this.name = 'CommercialHttpError'; this.status = status; this.code = code; } }

function buildModelRuntime(env) {
  const runtime = new ModelRuntime({ defaultTimeoutMs: Number(env.CORTEX_MODEL_TIMEOUT_MS ?? 45_000), failureThreshold: 3, circuitCooldownMs: 30_000 });
  if (env.OPENAI_API_KEY) runtime.register('openai', new OpenAIResponsesProvider({ apiKey: env.OPENAI_API_KEY, model: env.CORTEX_OPENAI_MODEL ?? 'gpt-5.4' }), pricing(env, 'OPENAI'));
  if (env.ANTHROPIC_API_KEY) runtime.register('anthropic', new AnthropicMessagesProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.CORTEX_ANTHROPIC_MODEL ?? 'claude-sonnet-5' }), pricing(env, 'ANTHROPIC'));
  if (env.GEMINI_API_KEY) runtime.register('google', new GeminiInteractionsProvider({ apiKey: env.GEMINI_API_KEY, model: env.CORTEX_GEMINI_MODEL ?? 'gemini-3.7-flash' }), pricing(env, 'GEMINI'));
  return runtime;
}
function pricing(env, prefix) { return { usdPer1MInput: Number(env[`CORTEX_${prefix}_INPUT_USD_PER_1M`] ?? 0), usdPer1MOutput: Number(env[`CORTEX_${prefix}_OUTPUT_USD_PER_1M`] ?? 0), hosted: true }; }
function normalizeAssistantContext(context) {
  if (!Array.isArray(context)) throw new CommercialHttpError(400, 'invalid_assistant_context');
  let total = 0;
  return context.slice(0, 32).map((part) => {
    const source = String(part?.source ?? 'workspace-data').slice(0, 80);
    const text = String(part?.text ?? '');
    total += text.length;
    if (total > 250_000) throw new CommercialHttpError(413, 'assistant_context_too_large');
    return { source, text };
  });
}
function requireEnvironment(env, keys) { const missing = keys.filter((key) => !env[key]); if (missing.length) throw new Error(`missing commercial environment: ${missing.join(', ')}`); }
