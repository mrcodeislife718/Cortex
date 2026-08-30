const clone = (value) => globalThis.structuredClone(value);

export const ExtensionRuntime = Object.freeze({
  UI: 'ui',
  WORKSPACE: 'workspace',
  LANGUAGE: 'language',
  TOOL: 'tool',
});

export class ExtensionPlatform {
  constructor({ securityKernel = null, processHost = null, clock = () => Date.now(), failureThreshold = 3 } = {}) {
    this.securityKernel = securityKernel;
    this.processHost = processHost;
    this.clock = clock;
    this.failureThreshold = failureThreshold;
    this.extensions = new Map();
  }

  install(manifest) {
    validateManifest(manifest);
    if (this.extensions.has(manifest.id)) throw new Error(`extension already installed: ${manifest.id}`);
    const normalized = normalizeManifest(manifest);
    const conflicts = this.#findContributionConflicts(normalized);
    const state = {
      manifest: normalized,
      status: 'installed',
      enabled: true,
      activated: false,
      activations: 0,
      failures: 0,
      lastError: null,
      lastActivationMs: null,
      conflicts,
      installedAt: this.clock(),
    };
    this.extensions.set(manifest.id, state);
    return this.describe(manifest.id);
  }

  uninstall(id) { return this.extensions.delete(id); }

  enable(id) {
    const state = this.#require(id);
    state.enabled = true;
    state.status = 'installed';
    state.disabledReason = null;
    return this.describe(id);
  }

  disable(id, reason = 'user') {
    const state = this.#require(id);
    state.enabled = false;
    state.activated = false;
    state.status = 'disabled';
    state.disabledReason = reason;
    return this.describe(id);
  }

  list() { return [...this.extensions.keys()].map((id) => this.describe(id)); }
  describe(id) { return clone(this.#require(id)); }

  eligibleFor(event) {
    return [...this.extensions.values()]
      .filter((state) => state.enabled && state.status !== 'quarantined')
      .filter((state) => state.manifest.activationEvents.includes(event) || state.manifest.activationEvents.includes('*'))
      .map((state) => state.manifest.id);
  }

  async activate(id, { event, runtime, token = null, loader } = {}) {
    return this.#activateWith(id, { event, runtime, token }, async (state) => {
      if (typeof loader !== 'function') throw new TypeError('extension activation requires a loader');
      return loader(clone(state.manifest));
    });
  }

  async activateIsolated(id, { event, runtime, token = null, modulePath, exportName = 'activate', payload = null, cwd, timeoutMs } = {}) {
    if (!this.processHost || typeof this.processHost.run !== 'function') throw new Error('isolated extension process host is not configured');
    if (!modulePath) throw new Error('isolated extension activation requires modulePath');
    return this.#activateWith(id, { event, runtime, token }, async (state) => {
      const execution = await this.processHost.run({ modulePath, exportName, payload, cwd, timeoutMs });
      state.lastProcessId = execution.pid ?? null;
      state.lastStdoutBytes = Buffer.byteLength(execution.stdout ?? '');
      state.lastStderrBytes = Buffer.byteLength(execution.stderr ?? '');
      return execution.result;
    });
  }

  health(id) {
    const state = this.#require(id);
    return {
      id,
      status: state.status,
      enabled: state.enabled,
      activated: state.activated,
      activations: state.activations,
      failures: state.failures,
      lastActivationMs: state.lastActivationMs,
      lastError: state.lastError,
      conflicts: clone(state.conflicts),
      lastProcessId: state.lastProcessId ?? null,
      lastStdoutBytes: state.lastStdoutBytes ?? 0,
      lastStderrBytes: state.lastStderrBytes ?? 0,
    };
  }

  async #activateWith(id, { event, runtime, token }, operation) {
    const state = this.#require(id);
    if (!state.enabled) throw new Error(`extension disabled: ${id}`);
    if (state.status === 'quarantined') throw new Error(`extension quarantined: ${id}`);
    if (!state.manifest.activationEvents.includes(event) && !state.manifest.activationEvents.includes('*')) throw new Error(`extension ${id} is not eligible for activation event ${event}`);
    if (runtime !== state.manifest.runtime) throw new Error(`extension ${id} requires ${state.manifest.runtime} runtime`);

    if (this.securityKernel && state.manifest.capabilities.length) {
      for (const capability of state.manifest.capabilities) {
        this.securityKernel.require(token, {
          capability,
          executionLevel: state.manifest.executionLevel,
          resource: `extension:${id}`,
        });
      }
    }

    const started = this.clock();
    try {
      const api = await operation(state);
      const elapsed = Math.max(0, this.clock() - started);
      state.lastActivationMs = elapsed;
      if (elapsed > state.manifest.budgets.activationMs) {
        state.failures++;
        state.lastError = `activation budget exceeded: ${elapsed}ms > ${state.manifest.budgets.activationMs}ms`;
        state.activated = false;
        state.status = state.failures >= this.failureThreshold ? 'quarantined' : 'degraded';
        throw new Error(state.lastError);
      }
      state.activated = true;
      state.status = 'active';
      state.activations++;
      state.lastError = null;
      return api;
    } catch (error) {
      if (!String(error?.message ?? error).startsWith('activation budget exceeded:')) {
        state.failures++;
        state.lastError = String(error?.message ?? error);
        state.activated = false;
        state.status = state.failures >= this.failureThreshold ? 'quarantined' : 'failed';
      }
      throw error;
    }
  }

  #findContributionConflicts(manifest) {
    const conflicts = [];
    for (const state of this.extensions.values()) {
      if (!state.enabled) continue;
      for (const [kind, values] of Object.entries(manifest.contributions)) {
        if (!Array.isArray(values)) continue;
        const existing = state.manifest.contributions[kind];
        if (!Array.isArray(existing)) continue;
        for (const value of values) {
          if (existing.includes(value)) conflicts.push({ kind, value, with: state.manifest.id });
        }
      }
    }
    return conflicts;
  }

  #require(id) {
    const state = this.extensions.get(id);
    if (!state) throw new Error(`unknown extension: ${id}`);
    return state;
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new TypeError('extension manifest is required');
  if (!/^[a-z0-9][a-z0-9.-]+$/i.test(manifest.id ?? '')) throw new Error('extension id is required');
  if (!manifest.version) throw new Error('extension version is required');
  if (!Object.values(ExtensionRuntime).includes(manifest.runtime)) throw new Error('extension runtime is invalid');
  if (!Array.isArray(manifest.activationEvents)) throw new Error('extension activationEvents must be an array');
  if (!Array.isArray(manifest.capabilities ?? [])) throw new Error('extension capabilities must be an array');
  if (manifest.activationEvents.includes('*') && !manifest.startupJustification) throw new Error('wildcard startup activation requires explicit justification');
  const activationMs = manifest.budgets?.activationMs ?? 500;
  if (!Number.isFinite(activationMs) || activationMs <= 0) throw new Error('extension activation budget must be positive');
}

function normalizeManifest(manifest) {
  return {
    id: manifest.id,
    version: manifest.version,
    runtime: manifest.runtime,
    activationEvents: [...new Set(manifest.activationEvents)],
    startupJustification: manifest.startupJustification ?? null,
    capabilities: [...new Set(manifest.capabilities ?? [])],
    executionLevel: manifest.executionLevel ?? 'OBSERVE',
    budgets: { activationMs: manifest.budgets?.activationMs ?? 500 },
    compatibility: { vscode: Boolean(manifest.compatibility?.vscode), apiVersion: manifest.compatibility?.apiVersion ?? null },
    contributions: clone(manifest.contributions ?? {}),
  };
}
