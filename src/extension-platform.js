const clone = (value) => globalThis.structuredClone(value);

export const ExtensionRuntime = Object.freeze({
  UI: 'ui',
  WORKSPACE: 'workspace',
  LANGUAGE: 'language',
  TOOL: 'tool',
});

export class ExtensionPlatform {
  constructor({ securityKernel = null, clock = () => Date.now(), failureThreshold = 3 } = {}) {
    this.securityKernel = securityKernel;
    this.clock = clock;
    this.failureThreshold = failureThreshold;
    this.extensions = new Map();
  }

  install(manifest) {
    validateManifest(manifest);
    if (this.extensions.has(manifest.id)) throw new Error(`extension already installed: ${manifest.id}`);
    const state = {
      manifest: normalizeManifest(manifest),
      status: 'installed',
      enabled: true,
      activated: false,
      activations: 0,
      failures: 0,
      lastError: null,
      lastActivationMs: null,
      installedAt: this.clock(),
    };
    this.extensions.set(manifest.id, state);
    return this.describe(manifest.id);
  }

  uninstall(id) {
    return this.extensions.delete(id);
  }

  enable(id) {
    const state = this.#require(id);
    state.enabled = true;
    state.status = 'installed';
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

  list() {
    return [...this.extensions.keys()].map((id) => this.describe(id));
  }

  describe(id) {
    return clone(this.#require(id));
  }

  eligibleFor(event) {
    return [...this.extensions.values()]
      .filter((state) => state.enabled && state.status !== 'quarantined')
      .filter((state) => state.manifest.activationEvents.includes(event))
      .map((state) => state.manifest.id);
  }

  async activate(id, { event, runtime, token = null, loader } = {}) {
    const state = this.#require(id);
    if (!state.enabled) throw new Error(`extension disabled: ${id}`);
    if (state.status === 'quarantined') throw new Error(`extension quarantined: ${id}`);
    if (!state.manifest.activationEvents.includes(event)) throw new Error(`extension ${id} is not eligible for activation event ${event}`);
    if (runtime !== state.manifest.runtime) throw new Error(`extension ${id} requires ${state.manifest.runtime} runtime`);
    if (typeof loader !== 'function') throw new TypeError('extension activation requires a loader');

    if (this.securityKernel && state.manifest.capabilities.length) {
      for (const capability of state.manifest.capabilities) this.securityKernel.require(token, capability, state.manifest.executionLevel);
    }

    const started = this.clock();
    try {
      const api = await loader(clone(state.manifest));
      state.activated = true;
      state.status = 'active';
      state.activations++;
      state.lastActivationMs = Math.max(0, this.clock() - started);
      state.lastError = null;
      return api;
    } catch (error) {
      state.failures++;
      state.lastError = String(error?.message ?? error);
      state.activated = false;
      state.status = state.failures >= this.failureThreshold ? 'quarantined' : 'failed';
      throw error;
    }
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
    };
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
}

function normalizeManifest(manifest) {
  return {
    id: manifest.id,
    version: manifest.version,
    runtime: manifest.runtime,
    activationEvents: [...new Set(manifest.activationEvents)],
    capabilities: [...new Set(manifest.capabilities ?? [])],
    executionLevel: manifest.executionLevel ?? 'OBSERVE',
    compatibility: {
      vscode: Boolean(manifest.compatibility?.vscode),
      apiVersion: manifest.compatibility?.apiVersion ?? null,
    },
    contributions: clone(manifest.contributions ?? {}),
  };
}
