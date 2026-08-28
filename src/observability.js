import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const clone = (value) => globalThis.structuredClone(value);

export class MetricsRegistry {
  constructor() { this.counters = new Map(); this.gauges = new Map(); this.histograms = new Map(); }
  increment(name, value = 1) { if (!Number.isFinite(value)) throw new Error('metric value must be finite'); this.counters.set(name, (this.counters.get(name) ?? 0) + value); return this.counters.get(name); }
  gauge(name, value) { if (!Number.isFinite(value)) throw new Error('metric value must be finite'); this.gauges.set(name, value); return value; }
  observe(name, value) { if (!Number.isFinite(value)) throw new Error('metric value must be finite'); const values = this.histograms.get(name) ?? []; values.push(value); this.histograms.set(name, values); return value; }
  snapshot() {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries([...this.histograms].map(([name, values]) => [name, summarize(values)])),
    };
  }
}

export class TraceRecorder {
  constructor({ clock = () => new Date().toISOString() } = {}) { this.clock = clock; this.traces = new Map(); }
  start(name, attributes = {}) {
    const trace = { id: crypto.randomUUID(), name, attributes: clone(attributes), startedAt: this.clock(), startedMono: performance.now(), spans: [], status: 'running' };
    this.traces.set(trace.id, trace);
    return trace.id;
  }
  span(traceId, name, attributes = {}) {
    const trace = this.#trace(traceId); const started = performance.now();
    return {
      end: (status = 'ok', extra = {}) => {
        const span = { id: crypto.randomUUID(), name, status, durationMs: performance.now() - started, attributes: { ...clone(attributes), ...clone(extra) } };
        trace.spans.push(span); return clone(span);
      },
    };
  }
  finish(traceId, status = 'ok', attributes = {}) {
    const trace = this.#trace(traceId); trace.status = status; trace.finishedAt = this.clock(); trace.durationMs = performance.now() - trace.startedMono; Object.assign(trace.attributes, clone(attributes)); delete trace.startedMono; return clone(trace);
  }
  get(traceId) { const trace = this.traces.get(traceId); if (!trace) return null; const output = clone(trace); delete output.startedMono; return output; }
  #trace(id) { const trace = this.traces.get(id); if (!trace) throw new Error('unknown trace'); return trace; }
}

export class StructuredLogger {
  constructor({ sink = (record) => process.stdout.write(`${JSON.stringify(record)}\n`), clock = () => new Date().toISOString(), redact = ['token','secret','password','authorization'] } = {}) {
    this.sink = sink; this.clock = clock; this.redact = new Set(redact.map((key) => key.toLowerCase()));
  }
  log(level, event, data = {}) { const record = { at: this.clock(), level, event, data: this.#sanitize(data) }; this.sink(record); return record; }
  info(event, data) { return this.log('info', event, data); }
  warn(event, data) { return this.log('warn', event, data); }
  error(event, data) { return this.log('error', event, data); }
  #sanitize(value, key = '') {
    if (this.redact.has(key.toLowerCase())) return '[REDACTED]';
    if (Array.isArray(value)) return value.map((item) => this.#sanitize(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, this.#sanitize(child, childKey)]));
    return value;
  }
}

function summarize(values) {
  if (!values.length) return { count: 0, min: null, max: null, avg: null, p95: null };
  const sorted = [...values].sort((a,b) => a-b); const sum = sorted.reduce((a,b) => a+b,0);
  return { count: sorted.length, min: sorted[0], max: sorted.at(-1), avg: sum / sorted.length, p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] };
}
