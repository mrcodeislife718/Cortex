import crypto from 'node:crypto';

const clone = (value) => globalThis.structuredClone(value);
const LEVELS = ['OBSERVE','PLAN','SAFE_EDIT','SANDBOX_EXECUTE','WORKSPACE_EXECUTE','PRIVILEGED_EXECUTE','EXTERNAL_SIDE_EFFECT','PRODUCTION'];

export class CapabilitySecurityKernel {
  constructor({ clock = () => new Date().toISOString(), defaultDeny = true } = {}) {
    this.clock = clock;
    this.defaultDeny = defaultDeny;
    this.tokens = new Map();
    this.audit = [];
  }

  issue({ subject, capabilities = [], maxExecutionLevel = 'PLAN', expiresAt = null, metadata = {} }) {
    if (!subject) throw new Error('security subject is required');
    if (!LEVELS.includes(maxExecutionLevel)) throw new Error('invalid execution level');
    const token = {
      id: crypto.randomUUID(), subject, capabilities: [...new Set(capabilities)], maxExecutionLevel,
      expiresAt, metadata: clone(metadata), issuedAt: this.clock(), revokedAt: null,
    };
    this.tokens.set(token.id, token);
    this.#record('token.issued', token.id, subject, { capabilities: token.capabilities, maxExecutionLevel });
    return clone(token);
  }

  revoke(tokenId, reason = 'revoked') {
    const token = this.tokens.get(tokenId);
    if (!token) return false;
    token.revokedAt = this.clock();
    this.#record('token.revoked', tokenId, token.subject, { reason });
    return true;
  }

  authorize(tokenId, { capability, executionLevel = 'OBSERVE', resource = null } = {}) {
    const token = this.tokens.get(tokenId);
    let allowed = true;
    let reason = 'authorized';
    if (!token) { allowed = false; reason = 'unknown-token'; }
    else if (token.revokedAt) { allowed = false; reason = 'revoked-token'; }
    else if (token.expiresAt && Date.parse(token.expiresAt) <= Date.now()) { allowed = false; reason = 'expired-token'; }
    else if (!LEVELS.includes(executionLevel)) { allowed = false; reason = 'invalid-execution-level'; }
    else if (LEVELS.indexOf(executionLevel) > LEVELS.indexOf(token.maxExecutionLevel)) { allowed = false; reason = 'execution-level-denied'; }
    else if (capability && !matchesCapability(token.capabilities, capability)) { allowed = false; reason = 'capability-denied'; }
    if (!token && !this.defaultDeny) allowed = true;
    this.#record('authorization', tokenId, token?.subject ?? null, { capability, executionLevel, resource, allowed, reason });
    return { allowed, reason };
  }

  require(tokenId, request) {
    const decision = this.authorize(tokenId, request);
    if (!decision.allowed) throw new Error(`cortex security policy denied operation: ${decision.reason}`);
    return decision;
  }

  auditLog() { return this.audit.map(clone); }

  #record(event, tokenId, subject, details) {
    this.audit.push({ id: crypto.randomUUID(), at: this.clock(), event, tokenId, subject, details: clone(details) });
  }
}

export class SecretBoundary {
  constructor({ resolver, security }) {
    if (typeof resolver !== 'function') throw new TypeError('secret resolver is required');
    this.resolver = resolver;
    this.security = security;
  }
  async read(tokenId, name) {
    this.security.require(tokenId, { capability: `secret.read:${name}`, executionLevel: 'PRIVILEGED_EXECUTE', resource: name });
    return this.resolver(name);
  }
}

export class PromptBoundary {
  constructor({ blockedPatterns = [] } = {}) { this.blockedPatterns = blockedPatterns.map((pattern) => new RegExp(pattern, 'i')); }
  classify(source, text) {
    const suspicious = this.blockedPatterns.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
    return { source, authority: source === 'system' || source === 'user' ? 'instruction' : 'data', suspicious };
  }
  compile(parts) {
    return parts.map(({ source, text }) => ({ source, text, ...this.classify(source, text) }));
  }
}

export const ExecutionLevels = Object.freeze([...LEVELS]);

function matchesCapability(granted, requested) {
  return granted.some((capability) => capability === requested || capability === '*' || (capability.endsWith('.*') && requested.startsWith(capability.slice(0, -1))));
}
