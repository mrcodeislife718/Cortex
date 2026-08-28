import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export class HttpTelemetryExporter {
  constructor({ endpoint, headers = {}, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
    if (!endpoint || typeof fetchImpl !== 'function') throw new Error('telemetry exporter requires endpoint and fetch');
    this.endpoint = endpoint;
    this.headers = { ...headers };
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }
  async export(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.headers },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`telemetry export failed (${response.status})`);
      return { ok: true, status: response.status };
    } finally { clearTimeout(timer); }
  }
}

export class CrashReporter {
  constructor({ directory, fileSystem = fs, clock = () => new Date().toISOString(), redact = defaultRedact } = {}) {
    if (!directory) throw new Error('crash reporter directory is required');
    this.directory = path.resolve(directory);
    this.fileSystem = fileSystem;
    this.clock = clock;
    this.redact = redact;
  }
  async record(error, context = {}) {
    await this.fileSystem.mkdir(this.directory, { recursive: true });
    const report = {
      schema: 'cortex.crash/v1',
      id: crypto.randomUUID(),
      at: this.clock(),
      error: { name: error?.name ?? 'Error', message: String(error?.message ?? error), stack: error?.stack ?? null },
      context: this.redact(context),
    };
    const file = path.join(this.directory, `${report.id}.json`);
    await this.fileSystem.writeFile(file, JSON.stringify(report, null, 2), { encoding: 'utf8', mode: 0o600 });
    return { id: report.id, file };
  }
  async list() {
    try { return (await this.fileSystem.readdir(this.directory)).filter((name) => name.endsWith('.json')).sort(); }
    catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  }
}

export class SloMonitor {
  constructor(definitions = {}) { this.definitions = new Map(Object.entries(definitions)); }
  evaluate(metrics) {
    const results = [];
    for (const [name, definition] of this.definitions) {
      const value = resolveMetric(metrics, definition.path);
      const ok = definition.max !== undefined ? value <= definition.max : definition.min !== undefined ? value >= definition.min : false;
      results.push({ name, ok, value, target: definition });
    }
    return { ok: results.every((result) => result.ok), results };
  }
}

function resolveMetric(value, pathExpression) {
  const pathParts = String(pathExpression).split('.');
  let current = value;
  for (const part of pathParts) current = current?.[part];
  if (!Number.isFinite(current)) throw new Error(`SLO metric is not finite: ${pathExpression}`);
  return current;
}

function defaultRedact(value, key = '') {
  if (/token|secret|password|authorization|cookie|api[_-]?key/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => defaultRedact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, defaultRedact(child, childKey)]));
  return value;
}
