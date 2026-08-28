const clone = (value) => globalThis.structuredClone(value);

export const CortexPlans = Object.freeze({
  PRO: Object.freeze({
    id: 'pro',
    monthlyUsd: 79,
    annualUsd: 790,
    entitlements: ['ide.desktop','ai.hosted','ai.frontier','ai.multi-agent','project.memory','system.graph','remote.ssh','remote.container','profiling.advanced','deploy.preview'],
  }),
  TEAM: Object.freeze({
    id: 'team',
    monthlyUsdPerSeat: 149,
    annualUsdPerSeat: 1490,
    minimumSeats: 3,
    entitlements: ['ide.desktop','ai.hosted','ai.frontier','ai.multi-agent','project.memory','system.graph','remote.ssh','remote.container','remote.workspace','team.memory','team.policy','team.audit','profiling.advanced','deploy.preview','deploy.production'],
  }),
  ENTERPRISE: Object.freeze({
    id: 'enterprise',
    annualMinimumUsd: 50000,
    entitlements: ['*'],
  }),
});

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

export function quoteCortex({ plan, seats = 1, annual = false }) {
  const selected = Object.values(CortexPlans).find((candidate) => candidate.id === plan);
  if (!selected) throw new Error('unknown Cortex plan');
  if (selected.id === 'enterprise') return { plan, annualMinimumUsd: selected.annualMinimumUsd, negotiated: true };
  if (selected.id === 'team') {
    if (seats < selected.minimumSeats) throw new Error(`team plan requires at least ${selected.minimumSeats} seats`);
    const unit = annual ? selected.annualUsdPerSeat : selected.monthlyUsdPerSeat;
    return { plan, seats, cadence: annual ? 'annual' : 'monthly', totalUsd: unit * seats };
  }
  return { plan, seats: 1, cadence: annual ? 'annual' : 'monthly', totalUsd: annual ? selected.annualUsd : selected.monthlyUsd };
}
