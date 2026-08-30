import crypto from 'node:crypto';

const clone = (value) => globalThis.structuredClone(value);
const KNOWLEDGE_STATES = new Set(['known','unknown','conflicting','stale','inferred','verified']);
const LOOP_STAGES = ['reason','decide','act','observe','verify','learn','preserve'];

export class EngineeringKnowledgeStore {
  constructor({ now = () => Date.now(), defaultTtlMs = 5 * 60_000 } = {}) {
    this.now = now;
    this.defaultTtlMs = defaultTtlMs;
    this.records = new Map();
    this.failures = new Map();
  }

  put(key, value, { state = 'known', provenance = [], confidence = 1, ttlMs = this.defaultTtlMs, evidence = [] } = {}) {
    if (!key) throw new Error('knowledge key is required');
    if (!KNOWLEDGE_STATES.has(state)) throw new Error(`invalid knowledge state: ${state}`);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('knowledge confidence must be between 0 and 1');
    const at = this.now();
    const record = {
      key,
      value: clone(value),
      state,
      confidence,
      provenance: clone(provenance),
      evidence: clone(evidence),
      createdAt: at,
      updatedAt: at,
      expiresAt: ttlMs === Infinity ? null : at + Math.max(0, ttlMs),
      revisions: 1,
    };
    const previous = this.records.get(key);
    if (previous && JSON.stringify(previous.value) !== JSON.stringify(value) && state !== 'verified') record.state = 'conflicting';
    if (previous) record.revisions = previous.revisions + 1;
    this.records.set(key, record);
    return this.get(key);
  }

  get(key) {
    const record = this.records.get(key);
    if (!record) return null;
    const result = clone(record);
    if (result.expiresAt !== null && this.now() > result.expiresAt && result.state !== 'verified') result.state = 'stale';
    return result;
  }

  verify(key, evidence) {
    const record = this.records.get(key);
    if (!record) throw new Error(`unknown knowledge key: ${key}`);
    record.state = 'verified';
    record.confidence = 1;
    record.evidence.push(clone(evidence));
    record.updatedAt = this.now();
    record.expiresAt = null;
    return this.get(key);
  }

  markUnknown(key, reason) { return this.put(key, null, { state: 'unknown', confidence: 0, provenance: [{ reason }] }); }
  unresolved() { return [...this.records.keys()].map((key) => this.get(key)).filter((record) => ['unknown','conflicting','stale','inferred'].includes(record.state)); }

  recordFailure(signature, detail) {
    if (!signature) throw new Error('failure signature is required');
    const previous = this.failures.get(signature) ?? { signature, occurrences: 0, firstSeenAt: this.now(), examples: [] };
    previous.occurrences += 1;
    previous.lastSeenAt = this.now();
    previous.examples.push(clone(detail));
    if (previous.examples.length > 20) previous.examples.shift();
    this.failures.set(signature, previous);
    return clone(previous);
  }

  failure(signature) { const value = this.failures.get(signature); return value ? clone(value) : null; }
}

export class WorkOrder {
  constructor({ goal, inputs = [], expectedOutputs = [], wiringNotes = [], risks = [], rollback = null, verification = [], authority = 'SAFE_EDIT', metadata = {} } = {}) {
    if (!goal?.trim()) throw new Error('work order goal is required');
    this.id = crypto.randomUUID();
    this.goal = goal.trim();
    this.inputs = clone(inputs);
    this.expectedOutputs = clone(expectedOutputs);
    this.wiringNotes = clone(wiringNotes);
    this.risks = clone(risks);
    this.rollback = clone(rollback);
    this.verification = clone(verification);
    this.authority = authority;
    this.metadata = clone(metadata);
    this.createdAt = new Date().toISOString();
    this.status = 'planned';
    this.actions = [];
  }
  addAction(action) { this.actions.push({ id: crypto.randomUUID(), at: new Date().toISOString(), ...clone(action) }); return clone(this.actions.at(-1)); }
  transition(status) {
    const allowed = { planned:['authorized','halted'], authorized:['executing','halted'], executing:['verifying','halted','rolled-back'], verifying:['passed','failed','rolled-back'], failed:['rolled-back'], passed:[], halted:[], 'rolled-back':[] };
    if (!allowed[this.status]?.includes(status)) throw new Error(`invalid work order transition ${this.status} -> ${status}`);
    this.status = status;
    return this.status;
  }
  snapshot() { return clone({ id:this.id, goal:this.goal, inputs:this.inputs, expectedOutputs:this.expectedOutputs, wiringNotes:this.wiringNotes, risks:this.risks, rollback:this.rollback, verification:this.verification, authority:this.authority, metadata:this.metadata, createdAt:this.createdAt, status:this.status, actions:this.actions }); }
}

export class VerificationPack {
  constructor({ workOrderId, required = [] } = {}) {
    if (!workOrderId) throw new Error('verification pack requires workOrderId');
    this.id = crypto.randomUUID();
    this.workOrderId = workOrderId;
    this.required = new Set(required);
    this.evidence = [];
    this.claims = [];
  }
  addEvidence(type, evidence, { ok = true, source = null } = {}) {
    if (!type) throw new Error('evidence type is required');
    const record = { id: crypto.randomUUID(), type, ok: Boolean(ok), source, at: new Date().toISOString(), evidence: clone(evidence) };
    this.evidence.push(record);
    return clone(record);
  }
  evaluate() {
    const present = new Set(this.evidence.filter((item) => item.ok).map((item) => item.type));
    const missing = [...this.required].filter((type) => !present.has(type));
    const failures = this.evidence.filter((item) => !item.ok);
    return { ok: missing.length === 0 && failures.length === 0, missing, failures: clone(failures), evidenceCount: this.evidence.length };
  }
  claim(statement) {
    const qualification = this.evaluate();
    const claim = { id: crypto.randomUUID(), statement, status: qualification.ok ? 'verified' : 'unverified', qualification, at: new Date().toISOString() };
    this.claims.push(claim);
    return clone(claim);
  }
  snapshot() { return clone({ id:this.id, workOrderId:this.workOrderId, required:[...this.required], evidence:this.evidence, claims:this.claims, qualification:this.evaluate() }); }
}

export class ClosedLoopEngineeringCycle {
  constructor({ workOrder, knowledge = new EngineeringKnowledgeStore() } = {}) {
    if (!(workOrder instanceof WorkOrder)) throw new Error('closed loop requires a WorkOrder');
    this.id = crypto.randomUUID();
    this.workOrder = workOrder;
    this.knowledge = knowledge;
    this.stageIndex = 0;
    this.events = [];
  }
  get stage() { return LOOP_STAGES[this.stageIndex]; }
  record(payload, { evidence = null } = {}) {
    const event = { id: crypto.randomUUID(), stage: this.stage, at: new Date().toISOString(), payload: clone(payload), evidence: clone(evidence) };
    this.events.push(event);
    return clone(event);
  }
  advance(next) {
    const expected = LOOP_STAGES[this.stageIndex + 1];
    if (next !== expected) throw new Error(`closed loop requires ${expected}, received ${next}`);
    this.stageIndex += 1;
    return this.stage;
  }
  preserve(key, value, options = {}) {
    if (this.stage !== 'preserve') throw new Error('knowledge may only be preserved at preserve stage');
    return this.knowledge.put(key, value, options);
  }
  snapshot() { return clone({ id:this.id, workOrderId:this.workOrder.id, stage:this.stage, events:this.events }); }
}

export class DependencyAwareAgentScheduler {
  constructor({ maxConcurrency = 4 } = {}) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) throw new Error('maxConcurrency must be >= 1');
    this.maxConcurrency = maxConcurrency;
  }

  async run(tasks, executor) {
    const byId = new Map(tasks.map((task) => [task.id, { ...clone(task), dependsOn:[...(task.dependsOn ?? [])] }]));
    if (byId.size !== tasks.length) throw new Error('duplicate task id');
    for (const task of byId.values()) for (const dependency of task.dependsOn) if (!byId.has(dependency)) throw new Error(`unknown dependency ${dependency}`);
    detectCycle(byId);
    const completed = new Map();
    const failed = new Map();
    const running = new Map();
    const pending = new Set(byId.keys());

    while (pending.size || running.size) {
      let launched = false;
      for (const id of [...pending]) {
        if (running.size >= this.maxConcurrency) break;
        const task = byId.get(id);
        if (task.dependsOn.some((dep) => failed.has(dep))) {
          pending.delete(id); failed.set(id, new Error('dependency failed')); continue;
        }
        if (!task.dependsOn.every((dep) => completed.has(dep))) continue;
        pending.delete(id); launched = true;
        const promise = Promise.resolve().then(() => executor(clone(task))).then((result) => ({ id, ok:true, result }), (error) => ({ id, ok:false, error }));
        running.set(id, promise);
      }
      if (!running.size) {
        if (pending.size) throw new Error('scheduler deadlock');
        break;
      }
      if (!launched || running.size >= this.maxConcurrency) {
        const outcome = await Promise.race(running.values());
        running.delete(outcome.id);
        if (outcome.ok) completed.set(outcome.id, clone(outcome.result)); else failed.set(outcome.id, outcome.error);
      }
    }
    return { ok: failed.size === 0, completed: Object.fromEntries(completed), failed: Object.fromEntries([...failed].map(([id,error]) => [id, error.message])) };
  }
}

function detectCycle(byId) {
  const visiting = new Set(), visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new Error('agent task dependency cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id).dependsOn) visit(dep);
    visiting.delete(id); visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
}

export const CortexKnowledgeStates = Object.freeze([...KNOWLEDGE_STATES]);
export const CortexClosedLoopStages = Object.freeze([...LOOP_STAGES]);
