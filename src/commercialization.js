const clone = (value) => globalThis.structuredClone(value);

export const CortexPlans = Object.freeze({
  PRO: Object.freeze({
    id: 'pro',
    entitlements: ['ide.desktop','ai.hosted','ai.frontier','ai.multi-agent','project.memory','system.graph','remote.ssh','remote.container','profiling.advanced','deploy.preview'],
  }),
  TEAM: Object.freeze({
    id: 'team',
    minimumSeats: 3,
    entitlements: ['ide.desktop','ai.hosted','ai.frontier','ai.multi-agent','project.memory','system.graph','remote.ssh','remote.container','remote.workspace','team.memory','team.policy','team.audit','profiling.advanced','deploy.preview','deploy.production'],
  }),
  ENTERPRISE: Object.freeze({
    id: 'enterprise',
    entitlements: ['*'],
  }),
});

const PLAN_IDS = new Set(Object.values(CortexPlans).map((plan) => plan.id));

export function commercialCatalogFromEnvironment(env = process.env) {
  const raw = String(env.CORTEX_COMMERCIAL_CATALOG_JSON ?? '').trim();
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('CORTEX_COMMERCIAL_CATALOG_JSON must be valid JSON'); }
  return validateCommercialCatalog(parsed);
}

export function validateCommercialCatalog(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Cortex commercial catalog must be an object');
  const currency = String(input.currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Cortex commercial catalog requires a three-letter currency');
  const plans = input.plans;
  if (!plans || typeof plans !== 'object' || Array.isArray(plans)) throw new Error('Cortex commercial catalog requires plans');
  const normalized = { currency, plans: {} };
  for (const planId of PLAN_IDS) {
    const source = plans[planId];
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error(`Cortex commercial catalog is missing ${planId}`);
    if (planId === 'enterprise') {
      normalized.plans.enterprise = Object.freeze({ annualMinimum: positiveInteger(source.annualMinimum, 'enterprise annualMinimum') });
      continue;
    }
    normalized.plans[planId] = Object.freeze({
      monthly: positiveInteger(source.monthly, `${planId} monthly`),
      annual: positiveInteger(source.annual, `${planId} annual`),
      unit: planId === 'team' ? 'seat' : 'account',
    });
  }
  return Object.freeze({ currency, plans: Object.freeze(normalized.plans) });
}

export function cataloguedCortexPlans(catalog) {
  if (!catalog) throw new Error('Cortex commercial catalog is not configured');
  const usd = catalog.currency === 'USD';
  const pro = catalog.plans.pro;
  const team = catalog.plans.team;
  const enterprise = catalog.plans.enterprise;
  return Object.freeze({
    PRO: Object.freeze({
      ...CortexPlans.PRO,
      currency: catalog.currency,
      monthlyAmount: pro.monthly,
      annualAmount: pro.annual,
      ...(usd ? { monthlyUsd: pro.monthly / 100, annualUsd: pro.annual / 100 } : {}),
    }),
    TEAM: Object.freeze({
      ...CortexPlans.TEAM,
      currency: catalog.currency,
      monthlyAmountPerSeat: team.monthly,
      annualAmountPerSeat: team.annual,
      ...(usd ? { monthlyUsdPerSeat: team.monthly / 100, annualUsdPerSeat: team.annual / 100 } : {}),
    }),
    ENTERPRISE: Object.freeze({
      ...CortexPlans.ENTERPRISE,
      currency: catalog.currency,
      annualMinimumAmount: enterprise.annualMinimum,
      ...(usd ? { annualMinimumUsd: enterprise.annualMinimum / 100 } : {}),
    }),
  });
}

function positiveInteger(value, label) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`Cortex commercial catalog ${label} must be a positive integer in minor currency units`);
  return amount;
}

export class EntitlementService {
  constructor({ plans = CortexPlans } = {}) { this.plans = plans; }
  resolve(subscription) {
    if (!subscription || subscription.status !== 'active') return { active: false, plan: null, entitlements: [] };
    const plan = Object.values(this.plans).find((candidate) => candidate.id === subscription.plan);
    if (!plan) throw new Error('unknown Cortex subscription plan');
    return { active: true, plan: plan.id, entitlements: [...plan.entitlements], subscription: clone(subscription) };
  }
  allows(subscription, entitlement) {
    const resolved = this.resolve(subscription);
    return resolved.active && (resolved.entitlements.includes('*') || resolved.entitlements.includes(entitlement));
  }
  require(subscription, entitlement) {
    if (!this.allows(subscription, entitlement)) throw new Error(`Cortex entitlement required: ${entitlement}`);
    return true;
  }
}

export class UsageMeter {
  constructor() { this.events = []; }
  record({ accountId, metric, quantity = 1, metadata = {} }) {
    if (!accountId || !metric || !Number.isFinite(quantity) || quantity < 0) throw new Error('invalid usage event');
    const event = { accountId, metric, quantity, metadata: clone(metadata), at: new Date().toISOString() };
    this.events.push(event); return clone(event);
  }
  total(accountId, metric) { return this.events.filter((event) => event.accountId === accountId && event.metric === metric).reduce((sum, event) => sum + event.quantity, 0); }
}

export function quoteCortex({ plan, seats = 1, annual = false, catalog }) {
  const selected = Object.values(CortexPlans).find((candidate) => candidate.id === plan);
  if (!selected) throw new Error('unknown Cortex plan');
  if (!catalog) throw new Error('Cortex commercial catalog is not configured');
  const offer = catalog.plans?.[plan];
  if (!offer) throw new Error(`Cortex commercial catalog is missing ${plan}`);
  const usd = catalog.currency === 'USD';
  if (selected.id === 'enterprise') {
    return {
      plan,
      currency: catalog.currency,
      annualMinimumAmount: offer.annualMinimum,
      ...(usd ? { annualMinimumUsd: offer.annualMinimum / 100 } : {}),
      negotiated: true,
    };
  }
  if (selected.id === 'team') {
    if (!Number.isInteger(seats) || seats < selected.minimumSeats) throw new Error(`team plan requires at least ${selected.minimumSeats} seats`);
    const unitAmount = annual ? offer.annual : offer.monthly;
    const totalAmount = unitAmount * seats;
    return {
      plan,
      seats,
      cadence: annual ? 'annual' : 'monthly',
      currency: catalog.currency,
      unitAmount,
      totalAmount,
      ...(usd ? { totalUsd: totalAmount / 100 } : {}),
    };
  }
  const totalAmount = annual ? offer.annual : offer.monthly;
  return {
    plan,
    seats: 1,
    cadence: annual ? 'annual' : 'monthly',
    currency: catalog.currency,
    totalAmount,
    ...(usd ? { totalUsd: totalAmount / 100 } : {}),
  };
}
