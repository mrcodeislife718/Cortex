import crypto from 'node:crypto';

const clone = (value) => globalThis.structuredClone(value);

export class ModelFabric {
  constructor() { this.providers = new Map(); }
  register(name, provider, metadata = {}) {
    if (!name || typeof provider?.generate !== 'function') throw new TypeError('model provider must implement generate()');
    this.providers.set(name, { provider, metadata: clone(metadata), failures: 0 });
    return this;
  }
  list() { return [...this.providers.entries()].map(([name, entry]) => ({ name, metadata: clone(entry.metadata), failures: entry.failures })); }
  async generate(request, { preferred = [], require = {} } = {}) {
    const candidates = this.#candidates(preferred, require);
    const errors = [];
    for (const [name, entry] of candidates) {
      try {
        const result = await entry.provider.generate(clone(request));
        if (result == null) throw new Error('empty model response');
        entry.failures = 0;
        return { provider: name, result: clone(result) };
      } catch (error) {
        entry.failures++;
        errors.push({ provider: name, message: error.message });
      }
    }
    throw new AggregateError(errors.map((error) => new Error(`${error.provider}: ${error.message}`)), 'all eligible model providers failed');
  }
  #candidates(preferred, require) {
    const order = [...new Set([...preferred, ...this.providers.keys()])];
    return order
      .filter((name) => this.providers.has(name))
      .map((name) => [name, this.providers.get(name)])
      .filter(([, entry]) => Object.entries(require).every(([key, value]) => entry.metadata[key] === value));
  }
}

export class AgentLedger {
  constructor({ clock = () => new Date().toISOString() } = {}) { this.clock = clock; this.tasks = new Map(); }
  begin({ goal, actor = 'user', metadata = {} }) {
    if (!goal) throw new Error('agent task goal is required');
    const task = { id: crypto.randomUUID(), goal, actor, metadata: clone(metadata), status: 'running', startedAt: this.clock(), finishedAt: null, events: [] };
    this.tasks.set(task.id, task);
    this.record(task.id, 'goal.accepted', { goal });
    return clone(task);
  }
  record(taskId, type, payload = {}) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('unknown agent task');
    const event = { id: crypto.randomUUID(), sequence: task.events.length + 1, at: this.clock(), type, payload: clone(payload) };
    task.events.push(event);
    return clone(event);
  }
  finish(taskId, { status, outcome = null, evidence = [] }) {
    if (!['passed','failed','cancelled'].includes(status)) throw new Error('invalid agent task terminal status');
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('unknown agent task');
    task.status = status; task.outcome = clone(outcome); task.evidence = clone(evidence); task.finishedAt = this.clock();
    this.record(taskId, 'task.finished', { status, evidence });
    return clone(task);
  }
  get(taskId) { const task = this.tasks.get(taskId); return task ? clone(task) : null; }
  all() { return [...this.tasks.values()].map(clone); }
}

export class EngineeringTaskGraph {
  constructor() { this.tasks = new Map(); }
  add({ id = crypto.randomUUID(), kind, title, dependsOn = [], requiredEvidence = [] }) {
    if (!kind || !title) throw new Error('task kind and title are required');
    if (this.tasks.has(id)) throw new Error('duplicate task id');
    for (const dependency of dependsOn) if (!this.tasks.has(dependency)) throw new Error(`unknown task dependency: ${dependency}`);
    const task = { id, kind, title, dependsOn: [...dependsOn], requiredEvidence: [...requiredEvidence], evidence: [], status: 'pending' };
    this.tasks.set(id, task); return clone(task);
  }
  ready() {
    return [...this.tasks.values()].filter((task) => task.status === 'pending' && task.dependsOn.every((id) => this.tasks.get(id)?.status === 'passed')).map(clone);
  }
  start(id) { const task = this.#get(id); if (!this.ready().some((candidate) => candidate.id === id)) throw new Error('task is not ready'); task.status = 'running'; return clone(task); }
  evidence(id, evidence) { const task = this.#get(id); task.evidence.push(clone(evidence)); return clone(task); }
  finish(id, { passed }) {
    const task = this.#get(id);
    if (task.status !== 'running') throw new Error('task is not running');
    const evidenceTypes = new Set(task.evidence.map((evidence) => evidence.type));
    const missing = task.requiredEvidence.filter((type) => !evidenceTypes.has(type));
    if (passed && missing.length) throw new Error(`task missing required evidence: ${missing.join(', ')}`);
    task.status = passed ? 'passed' : 'failed';
    return clone(task);
  }
  snapshot() { return [...this.tasks.values()].map(clone); }
  #get(id) { const task = this.tasks.get(id); if (!task) throw new Error('unknown engineering task'); return task; }
}

export class QualificationGate {
  constructor({ required = ['tests','security','review'] } = {}) { this.required = required; }
  evaluate(evidence = []) {
    const byType = new Map(evidence.map((item) => [item.type, item]));
    const missing = this.required.filter((type) => !byType.has(type));
    const failures = evidence.filter((item) => item.ok === false);
    return { ok: missing.length === 0 && failures.length === 0, missing, failures: clone(failures) };
  }
}
