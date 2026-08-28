const clone = (value) => globalThis.structuredClone(value);

export class HostedProcessingPolicy {
  constructor({ allowHosted = true, allowedProviders = ['*'], allowedRegions = ['*'], allowTraining = false, maxRetentionDays = 0 } = {}) {
    this.allowHosted = allowHosted;
    this.allowedProviders = new Set(allowedProviders);
    this.allowedRegions = new Set(allowedRegions);
    this.allowTraining = allowTraining;
    this.maxRetentionDays = maxRetentionDays;
  }

  evaluate({ provider, region = 'unknown', training = false, retentionDays = 0, containsSecrets = false }) {
    const reasons = [];
    if (!this.allowHosted) reasons.push('hosted-processing-disabled');
    if (!this.allowedProviders.has('*') && !this.allowedProviders.has(provider)) reasons.push('provider-not-allowed');
    if (!this.allowedRegions.has('*') && !this.allowedRegions.has(region)) reasons.push('region-not-allowed');
    if (training && !this.allowTraining) reasons.push('training-not-allowed');
    if (retentionDays > this.maxRetentionDays) reasons.push('retention-exceeds-policy');
    if (containsSecrets) reasons.push('secrets-require-explicit-release');
    return { allowed: reasons.length === 0, reasons };
  }
}

export class DataLifecycleManager {
  constructor({ clock = () => new Date(), retentionDays = 30 } = {}) {
    this.clock = clock;
    this.retentionDays = retentionDays;
    this.domains = new Map();
  }

  register(name, adapter) {
    if (!name || typeof adapter?.exportData !== 'function' || typeof adapter?.deleteData !== 'function') throw new Error('privacy adapter must implement exportData and deleteData');
    this.domains.set(name, adapter);
    return this;
  }

  async exportAccount(accountId) {
    if (!accountId) throw new Error('account id is required');
    const data = {};
    for (const [name, adapter] of this.domains) data[name] = clone(await adapter.exportData(accountId));
    return { schema: 'cortex.account-export/v1', accountId, exportedAt: this.clock().toISOString(), data };
  }

  async deleteAccount(accountId, { reason = 'user-request' } = {}) {
    if (!accountId) throw new Error('account id is required');
    const results = {};
    for (const [name, adapter] of this.domains) results[name] = clone(await adapter.deleteData(accountId, { reason }));
    return { accountId, deletedAt: this.clock().toISOString(), reason, results };
  }

  cutoff() {
    const cutoff = new Date(this.clock());
    cutoff.setUTCDate(cutoff.getUTCDate() - this.retentionDays);
    return cutoff;
  }

  async enforceRetention() {
    const cutoff = this.cutoff();
    const results = {};
    for (const [name, adapter] of this.domains) {
      if (typeof adapter.deleteBefore === 'function') results[name] = clone(await adapter.deleteBefore(cutoff));
    }
    return { cutoff: cutoff.toISOString(), results };
  }
}

export class ContextReleasePolicy {
  constructor({ secretPatterns = [/api[_-]?key/i, /password/i, /authorization/i, /private[_-]?key/i], maxBytes = 2 * 1024 * 1024 } = {}) {
    this.secretPatterns = secretPatterns;
    this.maxBytes = maxBytes;
  }

  inspect(parts) {
    let bytes = 0;
    const findings = [];
    const safe = [];
    for (const part of parts) {
      const text = String(part.text ?? '');
      bytes += Buffer.byteLength(text);
      const secretLike = this.secretPatterns.some((pattern) => pattern.test(text));
      if (secretLike) findings.push({ source: part.source, reason: 'secret-like-content' });
      safe.push({ ...clone(part), secretLike });
    }
    if (bytes > this.maxBytes) findings.push({ source: 'context', reason: 'context-size-limit' });
    return { allowed: findings.length === 0, bytes, findings, parts: safe };
  }
}
