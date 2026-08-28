import { performance } from 'node:perf_hooks';

const clone = (value) => globalThis.structuredClone(value);

export class PerformanceQualification {
  constructor({ budgets = {} } = {}) {
    this.budgets = {
      startupMs: 1500,
      commandP95Ms: 50,
      typingP95Ms: 16,
      completionP95Ms: 150,
      searchP95Ms: 250,
      idleRssMb: 350,
      activeRssMb: 700,
      extensionActivationP95Ms: 250,
      ...budgets,
    };
    this.samples = new Map();
  }

  record(metric, value) {
    if (!Number.isFinite(value) || value < 0) throw new Error('performance sample must be a non-negative finite number');
    const samples = this.samples.get(metric) ?? [];
    samples.push(value);
    this.samples.set(metric, samples);
    return value;
  }

  async measure(metric, operation) {
    const started = performance.now();
    const result = await operation();
    this.record(metric, performance.now() - started);
    return result;
  }

  evaluate() {
    const measurements = {};
    const failures = [];
    for (const [metric, samples] of this.samples) {
      const stats = summarize(samples);
      measurements[metric] = stats;
      const budgetKey = budgetForMetric(metric);
      const budget = budgetKey ? this.budgets[budgetKey] : undefined;
      if (Number.isFinite(budget)) {
        const observed = metric.endsWith('.rssMb') || metric === 'startup' ? stats.max : stats.p95;
        if (observed > budget) failures.push({ metric, budgetKey, budget, observed });
      }
    }
    return { ok: failures.length === 0, budgets: clone(this.budgets), measurements, failures };
  }
}

export class DeadWeightAuditor {
  constructor({ maxAlwaysOn = 8, maxBackgroundProcesses = 6, maxDuplicateContributions = 0 } = {}) {
    this.maxAlwaysOn = maxAlwaysOn;
    this.maxBackgroundProcesses = maxBackgroundProcesses;
    this.maxDuplicateContributions = maxDuplicateContributions;
  }

  evaluate({ alwaysOn = [], backgroundProcesses = [], duplicateContributions = [], unusedIndexes = [], redundantWatchers = [] } = {}) {
    const findings = [];
    if (alwaysOn.length > this.maxAlwaysOn) findings.push({ code: 'always-on.excess', count: alwaysOn.length, limit: this.maxAlwaysOn });
    if (backgroundProcesses.length > this.maxBackgroundProcesses) findings.push({ code: 'background-process.excess', count: backgroundProcesses.length, limit: this.maxBackgroundProcesses });
    if (duplicateContributions.length > this.maxDuplicateContributions) findings.push({ code: 'duplicate-contribution', count: duplicateContributions.length, limit: this.maxDuplicateContributions });
    for (const index of unusedIndexes) findings.push({ code: 'index.unused', item: index });
    for (const watcher of redundantWatchers) findings.push({ code: 'watcher.redundant', item: watcher });
    return { ok: findings.length === 0, findings };
  }
}

export function scaleQualification({ base, factors = [1, 10, 100], project = (value, factor) => value * factor } = {}) {
  if (!base || typeof base !== 'object') throw new Error('base measurements are required');
  return factors.map((factor) => ({ factor, measurements: Object.fromEntries(Object.entries(base).map(([key, value]) => [key, project(value, factor, key)])) }));
}

function budgetForMetric(metric) {
  return ({
    startup: 'startupMs',
    command: 'commandP95Ms',
    typing: 'typingP95Ms',
    completion: 'completionP95Ms',
    search: 'searchP95Ms',
    'idle.rssMb': 'idleRssMb',
    'active.rssMb': 'activeRssMb',
    'extension.activation': 'extensionActivationP95Ms',
  })[metric] ?? null;
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
  return { count: sorted.length, min: sorted[0] ?? null, max: sorted.at(-1) ?? null, avg: sorted.length ? sum / sorted.length : null, p50: sorted.length ? at(0.5) : null, p95: sorted.length ? at(0.95) : null, p99: sorted.length ? at(0.99) : null };
}
