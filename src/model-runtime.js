const clone = (value) => globalThis.structuredClone(value);

export class ModelRuntime {
  constructor({ clock = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), defaultTimeoutMs = 45_000, failureThreshold = 3, circuitCooldownMs = 30_000 } = {}) {
    this.clock = clock;
    this.sleep = sleep;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.failureThreshold = failureThreshold;
    this.circuitCooldownMs = circuitCooldownMs;
    this.providers = new Map();
    this.usage = new Map();
  }

  register(name, provider, metadata = {}) {
    if (!name || typeof provider?.generate !== 'function') throw new TypeError('model provider must implement generate()');
    this.providers.set(name, {
      provider,
      metadata: clone(metadata),
      consecutiveFailures: 0,
      circuitOpenUntil: 0,
      requests: 0,
      failures: 0,
    });
    return this;
  }

  list() {
    return [...this.providers.entries()].map(([name, state]) => ({
      name,
      metadata: clone(state.metadata),
      consecutiveFailures: state.consecutiveFailures,
      circuitOpenUntil: state.circuitOpenUntil,
      requests: state.requests,
      failures: state.failures,
    }));
  }

  async generate(request, {
    preferred = [],
    require = {},
    timeoutMs = this.defaultTimeoutMs,
    retries = 1,
    validate = (value) => value !== null && value !== undefined,
    accountId = 'local',
    budgetUsd = Infinity,
  } = {}) {
    if (!Number.isFinite(budgetUsd) && budgetUsd !== Infinity) throw new Error('model budget must be finite or Infinity');
    if (budgetUsd < 0) throw new Error('model budget must be non-negative');
    const candidates = this.#candidates(preferred, require);
    if (!candidates.length) throw new Error('no eligible model providers');
    const errors = [];

    for (const [name, state] of candidates) {
      if (state.circuitOpenUntil > this.clock()) continue;
      const estimated = estimateRequestCost(request, state.metadata);
      if (estimated > budgetUsd) {
        errors.push(new Error(`${name}: request would exceed per-request model budget`));
        continue;
      }
      for (let attempt = 0; attempt <= retries; attempt++) {
        state.requests++;
        try {
          const result = await withTimeout((signal) => state.provider.generate(clone(request), { signal }), timeoutMs);
          if (!validate(result)) throw new MalformedModelResponseError(name);
          const cost = costFromResult(result, request, state.metadata);
          if (cost > budgetUsd) throw new Error(`${name}: model response exceeded per-request cost budget`);
          this.usage.set(accountId, (this.usage.get(accountId) ?? 0) + cost);
          state.consecutiveFailures = 0;
          state.circuitOpenUntil = 0;
          return { provider: name, result: clone(result), costUsd: cost, attempts: attempt + 1 };
        } catch (error) {
          state.failures++;
          state.consecutiveFailures++;
          errors.push(new Error(`${name}[${attempt + 1}]: ${error.message}`));
          if (state.consecutiveFailures >= this.failureThreshold) state.circuitOpenUntil = this.clock() + this.circuitCooldownMs;
          if (attempt < retries && retryable(error)) await this.sleep(Math.min(1000, 100 * (2 ** attempt)));
          else break;
        }
      }
    }
    throw new AggregateError(errors, 'all eligible model providers failed');
  }

  async *stream(request, { provider: providerName, timeoutMs = this.defaultTimeoutMs } = {}) {
    const state = this.providers.get(providerName);
    if (!state) throw new Error(`unknown model provider: ${providerName}`);
    if (typeof state.provider.stream !== 'function') throw new Error(`model provider does not support streaming: ${providerName}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`model stream exceeded ${timeoutMs}ms`)), timeoutMs);
    try {
      for await (const chunk of state.provider.stream(clone(request), { signal: controller.signal })) {
        if (chunk === undefined) throw new MalformedModelResponseError(providerName);
        yield clone(chunk);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  spent(accountId = 'local') { return this.usage.get(accountId) ?? 0; }
  resetBudget(accountId = 'local') { this.usage.delete(accountId); }

  #candidates(preferred, require) {
    const order = [...new Set([...preferred, ...this.providers.keys()])];
    return order
      .filter((name) => this.providers.has(name))
      .map((name) => [name, this.providers.get(name)])
      .filter(([, state]) => Object.entries(require).every(([key, value]) => state.metadata[key] === value));
  }
}

export class MalformedModelResponseError extends Error {
  constructor(provider) { super(`malformed model response from ${provider}`); this.name = 'MalformedModelResponseError'; }
}

async function withTimeout(operation, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`model request exceeded ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function retryable(error) {
  const message = String(error?.message ?? error).toLowerCase();
  return /timeout|timed out|rate|429|overload|503|502|network|temporar/.test(message);
}

function estimateRequestCost(request, metadata) {
  const inputTokens = Number(request?.usageEstimate?.inputTokens ?? 0);
  return inputTokens / 1_000_000 * Number(metadata.usdPer1MInput ?? 0);
}

function costFromResult(result, request, metadata) {
  const inputTokens = Number(result?.usage?.inputTokens ?? request?.usageEstimate?.inputTokens ?? 0);
  const outputTokens = Number(result?.usage?.outputTokens ?? 0);
  return (inputTokens / 1_000_000 * Number(metadata.usdPer1MInput ?? 0)) + (outputTokens / 1_000_000 * Number(metadata.usdPer1MOutput ?? 0));
}
