import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const clone = (value) => globalThis.structuredClone(value);

export class AtomicJsonStore {
  constructor(file, { fileSystem = fs } = {}) { this.file = path.resolve(file); this.fileSystem = fileSystem; }
  async load({ fallback = null } = {}) {
    try {
      const text = await this.fileSystem.readFile(this.file, 'utf8');
      const envelope = JSON.parse(text);
      if (envelope.schema !== 'cortex.atomic-json/v1') throw new Error('unsupported durable state schema');
      const payload = JSON.stringify(envelope.value);
      const digest = crypto.createHash('sha256').update(payload).digest('hex');
      if (digest !== envelope.sha256) throw new Error('durable state integrity check failed');
      return clone(envelope.value);
    } catch (error) {
      if (error.code === 'ENOENT' && fallback !== null) return clone(fallback);
      throw error;
    }
  }
  async save(value) {
    await this.fileSystem.mkdir(path.dirname(this.file), { recursive: true });
    const payload = JSON.stringify(value);
    const envelope = JSON.stringify({ schema: 'cortex.atomic-json/v1', sha256: crypto.createHash('sha256').update(payload).digest('hex'), value }, null, 2);
    const temp = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await this.fileSystem.writeFile(temp, envelope, { encoding: 'utf8', mode: 0o600 });
    await this.fileSystem.rename(temp, this.file);
    return { file: this.file, bytes: Buffer.byteLength(envelope) };
  }
}

export class ProjectMemoryStore {
  constructor(store) { this.store = store; this.state = { schema: 'cortex.project-memory/v1', revision: 0, facts: {} }; }
  async open() { this.state = await this.store.load({ fallback: this.state }); return this; }
  get(key) { return clone(this.state.facts[key] ?? null); }
  all() { return clone(this.state); }
  async set(key, value, { source, confidence = 1 } = {}) {
    if (!source) throw new Error('project memory facts require provenance source');
    this.state.facts[key] = { value: clone(value), source, confidence, updatedAt: new Date().toISOString() };
    this.state.revision++;
    await this.store.save(this.state);
    return this.get(key);
  }
  async delete(key) { const deleted = delete this.state.facts[key]; if (deleted) { this.state.revision++; await this.store.save(this.state); } return deleted; }
}

export class RecoveryJournal {
  constructor(store) { this.store = store; this.entries = []; }
  async open() { this.entries = await this.store.load({ fallback: [] }); return this; }
  async checkpoint(type, state, metadata = {}) {
    const entry = { id: crypto.randomUUID(), type, at: new Date().toISOString(), state: clone(state), metadata: clone(metadata) };
    this.entries.push(entry); await this.store.save(this.entries); return clone(entry);
  }
  latest(type) { return clone([...this.entries].reverse().find((entry) => !type || entry.type === type) ?? null); }
  async prune({ keep = 50 } = {}) { this.entries = this.entries.slice(-keep); await this.store.save(this.entries); return this.entries.length; }
}
