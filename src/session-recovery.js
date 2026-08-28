import crypto from 'node:crypto';

const clone = (value) => globalThis.structuredClone(value);

export class WorkspaceSessionRecovery {
  constructor({ store, clock = () => new Date().toISOString() }) {
    if (!store || typeof store.load !== 'function' || typeof store.save !== 'function') throw new TypeError('session recovery requires a durable store');
    this.store = store;
    this.clock = clock;
    this.state = emptyState();
  }

  async open() {
    const loaded = await this.store.load({ fallback: emptyState() });
    validateState(loaded);
    this.state = loaded;
    return this;
  }

  async checkpoint({ workspace, layout = {}, openEditors = [], unsavedBuffers = [], terminals = [], debug = null, metadata = {} }) {
    if (!workspace) throw new Error('workspace is required');
    const buffers = unsavedBuffers.map((buffer) => normalizeBuffer(buffer));
    this.state = {
      schema: 'cortex.workspace-session/v1',
      revision: this.state.revision + 1,
      checkpointId: crypto.randomUUID(),
      savedAt: this.clock(),
      workspace,
      layout: clone(layout),
      openEditors: clone(openEditors),
      unsavedBuffers: buffers,
      terminals: clone(terminals),
      debug: clone(debug),
      metadata: clone(metadata),
    };
    await this.store.save(this.state);
    return this.snapshot();
  }

  snapshot() { return clone(this.state); }

  restore({ workspace = null } = {}) {
    validateState(this.state);
    if (workspace && this.state.workspace && workspace !== this.state.workspace) throw new Error('recovery checkpoint belongs to a different workspace');
    for (const buffer of this.state.unsavedBuffers) {
      const digest = crypto.createHash('sha256').update(buffer.text).digest('hex');
      if (digest !== buffer.sha256) throw new Error(`unsaved buffer integrity failure: ${buffer.uri}`);
    }
    return this.snapshot();
  }

  async clear() {
    this.state = emptyState();
    await this.store.save(this.state);
    return this.snapshot();
  }
}

function normalizeBuffer(buffer) {
  if (!buffer?.uri || typeof buffer.text !== 'string') throw new Error('unsaved buffers require uri and text');
  return {
    uri: buffer.uri,
    language: buffer.language ?? null,
    version: Number.isInteger(buffer.version) ? buffer.version : 0,
    text: buffer.text,
    sha256: crypto.createHash('sha256').update(buffer.text).digest('hex'),
  };
}

function emptyState() {
  return {
    schema: 'cortex.workspace-session/v1', revision: 0, checkpointId: null, savedAt: null,
    workspace: null, layout: {}, openEditors: [], unsavedBuffers: [], terminals: [], debug: null, metadata: {},
  };
}

function validateState(state) {
  if (state?.schema !== 'cortex.workspace-session/v1') throw new Error('unsupported workspace session schema');
  if (!Number.isInteger(state.revision) || state.revision < 0) throw new Error('invalid workspace session revision');
  if (!Array.isArray(state.openEditors) || !Array.isArray(state.unsavedBuffers) || !Array.isArray(state.terminals)) throw new Error('corrupt workspace session');
}
