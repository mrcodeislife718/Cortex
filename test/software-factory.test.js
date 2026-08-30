import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineeringKnowledgeStore, WorkOrder, VerificationPack, ClosedLoopEngineeringCycle, DependencyAwareAgentScheduler } from '../src/software-factory.js';

test('knowledge store tracks conflict, staleness, verification and failure learning', () => {
  let now = 1000;
  const store = new EngineeringKnowledgeStore({ now: () => now, defaultTtlMs: 100 });
  store.put('api.shape', { version: 1 }, { provenance: [{ source: 'repo' }] });
  store.put('api.shape', { version: 2 }, { provenance: [{ source: 'runtime' }] });
  assert.equal(store.get('api.shape').state, 'conflicting');
  store.verify('api.shape', { test: 'contract-suite', ok: true });
  now += 1000;
  assert.equal(store.get('api.shape').state, 'verified');
  const failure = store.recordFailure('EADDRINUSE', { port: 3000 });
  assert.equal(failure.occurrences, 1);
  assert.equal(store.failure('EADDRINUSE').examples[0].port, 3000);
});

test('work order enforces authorized execution and verification lifecycle', () => {
  const order = new WorkOrder({ goal: 'repair terminal wiring', verification: ['build','pty'], rollback: { ref: 'before' } });
  assert.equal(order.status, 'planned');
  order.transition('authorized');
  order.transition('executing');
  order.addAction({ type: 'edit', path: 'pty.rs' });
  order.transition('verifying');
  assert.throws(() => order.transition('authorized'));
  order.transition('passed');
  assert.equal(order.snapshot().status, 'passed');
});

test('verification pack cannot verify a claim with missing or failed evidence', () => {
  const order = new WorkOrder({ goal: 'prove workbench interaction' });
  const pack = new VerificationPack({ workOrderId: order.id, required: ['build','interaction'] });
  pack.addEvidence('build', { sha: 'abc' });
  assert.equal(pack.claim('Cortex works').status, 'unverified');
  pack.addEvidence('interaction', { workflow: 'open-folder' }, { ok: true });
  assert.equal(pack.claim('Cortex open-folder works').status, 'verified');
  pack.addEvidence('security', { escape: true }, { ok: false });
  assert.equal(pack.claim('Cortex is fully verified').status, 'unverified');
});

test('closed loop requires reason decide act observe verify learn preserve order', () => {
  const order = new WorkOrder({ goal: 'fix a failing test' });
  const cycle = new ClosedLoopEngineeringCycle({ workOrder: order });
  cycle.record({ hypothesis: 'broken import' });
  for (const stage of ['decide','act','observe','verify','learn','preserve']) cycle.advance(stage);
  const preserved = cycle.preserve('failure.import', { cause: 'wrong path' }, { state: 'verified', evidence: [{ test: 'green' }] });
  assert.equal(preserved.state, 'verified');
});

test('dependency-aware agent scheduler respects dependencies and contains failure', async () => {
  const scheduler = new DependencyAwareAgentScheduler({ maxConcurrency: 2 });
  const order = [];
  const result = await scheduler.run([
    { id: 'inspect' },
    { id: 'edit', dependsOn: ['inspect'] },
    { id: 'verify', dependsOn: ['edit'] },
  ], async (task) => { order.push(task.id); return task.id.toUpperCase(); });
  assert.equal(result.ok, true);
  assert.deepEqual(order, ['inspect','edit','verify']);
  assert.equal(result.completed.verify, 'VERIFY');

  const failed = await scheduler.run([
    { id: 'a' },
    { id: 'b', dependsOn: ['a'] },
  ], async (task) => { if (task.id === 'a') throw new Error('boom'); return 'never'; });
  assert.equal(failed.ok, false);
  assert.equal(failed.failed.a, 'boom');
  assert.equal(failed.failed.b, 'dependency failed');
});
