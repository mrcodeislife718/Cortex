import crypto from 'node:crypto';

const clone = (value) => globalThis.structuredClone(value);

export class DeterministicRequestCache {
  constructor({ maxEntries = 500, ttlMs = 15 * 60 * 1000, clock = () => Date.now() } = {}) {
    this.maxEntries = maxEntries; this.ttlMs = ttlMs; this.clock = clock; this.entries = new Map();
  }
  key(request, scope = 'default') { return crypto.createHash('sha256').update(`${scope}:${canonicalJson(request)}`).digest('hex'); }
  get(request, { scope = 'default' } = {}) {
    const key = this.key(request, scope); const entry = this.entries.get(key); if (!entry) return null;
    if (this.clock() - entry.createdAt > this.ttlMs) { this.entries.delete(key); return null; }
    this.entries.delete(key); this.entries.set(key, entry);
    return clone(entry.value);
  }
  set(request, value, { scope = 'default' } = {}) {
    const key = this.key(request, scope); this.entries.set(key, { value: clone(value), createdAt: this.clock() });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    return key;
  }
  invalidateScope(scope) {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      void entry;
      if (key === this.key({}, scope)) continue;
    }
    for (const key of [...this.entries.keys()]) { this.entries.delete(key); removed++; }
    return removed;
  }
  clear() { const count = this.entries.size; this.entries.clear(); return count; }
}

export class QuotaManager {
  constructor({ limits = {}, clock = () => new Date() } = {}) { this.limits = clone(limits); this.clock = clock; this.usage = new Map(); }
  consume(accountId, metric, quantity = 1) {
    if (!accountId || !metric || !Number.isFinite(quantity) || quantity < 0) throw new Error('invalid quota consumption');
    const window = monthKey(this.clock()); const key = `${accountId}:${window}:${metric}`; const next = (this.usage.get(key) ?? 0) + quantity;
    const limit = this.limits[metric] ?? Infinity;
    if (next > limit) throw new QuotaExceededError(metric, limit, next);
    this.usage.set(key, next); return { metric, used: next, limit, remaining: Number.isFinite(limit) ? Math.max(0, limit - next) : Infinity, window };
  }
  status(accountId, metric) {
    const window = monthKey(this.clock()); const used = this.usage.get(`${accountId}:${window}:${metric}`) ?? 0; const limit = this.limits[metric] ?? Infinity;
    return { metric, used, limit, remaining: Number.isFinite(limit) ? Math.max(0, limit - used) : Infinity, window };
  }
}

export class SpendPolicy {
  constructor({ perRequestUsd = Infinity, dailyUsd = Infinity, monthlyUsd = Infinity, clock = () => new Date() } = {}) {
    this.perRequestUsd = perRequestUsd; this.dailyUsd = dailyUsd; this.monthlyUsd = monthlyUsd; this.clock = clock; this.events = [];
  }
  authorize(amountUsd) {
    if (!Number.isFinite(amountUsd) || amountUsd < 0) throw new Error('invalid spend amount');
    const now = this.clock(); const day = dayKey(now); const month = monthKey(now);
    const daily = this.events.filter((event) => event.day === day).reduce((sum, event) => sum + event.amountUsd, 0);
    const monthly = this.events.filter((event) => event.month === month).reduce((sum, event) => sum + event.amountUsd, 0);
    const reasons = [];
    if (amountUsd > this.perRequestUsd) reasons.push('per-request-budget');
    if (daily + amountUsd > this.dailyUsd) reasons.push('daily-budget');
    if (monthly + amountUsd > this.monthlyUsd) reasons.push('monthly-budget');
    return { allowed: reasons.length === 0, reasons, projected: { request: amountUsd, daily: daily + amountUsd, monthly: monthly + amountUsd } };
  }
  record(amountUsd, metadata = {}) { const decision = this.authorize(amountUsd); if (!decision.allowed) throw new Error(`spend denied: ${decision.reasons.join(',')}`); const now = this.clock(); this.events.push({ amountUsd, day: dayKey(now), month: monthKey(now), metadata: clone(metadata) }); return decision; }
}

export class QuotaExceededError extends Error {
  constructor(metric, limit, attempted) { super(`quota exceeded for ${metric}: limit ${limit}, attempted ${attempted}`); this.name = 'QuotaExceededError'; this.metric = metric; this.limit = limit; this.attempted = attempted; }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function dayKey(date) { return date.toISOString().slice(0, 10); }
function monthKey(date) { return date.toISOString().slice(0, 7); }
