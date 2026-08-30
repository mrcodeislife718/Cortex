import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineeringRuntime, ToolRegistry } from '../src/engineering-runtime.js';
import { ModelRuntime } from '../src/model-runtime.js';
import { QualificationGate } from '../src/intelligence-fabric.js';

test('EngineeringRuntime creates a work order, closed loop and verification pack', async () => {
  const modelRuntime = new ModelRuntime();
  modelRuntime.register('local', { generate: async () => ({ text: 'implemented' }) });
  const tools = new ToolRegistry();
  tools.register('tests', async () => ({ ok: true, passed: 4 }), { evidenceType: 'tests' });
  tools.register('security', async () => ({ ok: true, escapes: 0 }), { evidenceType: 'security' });
  tools.register('review', async () => ({ ok: true }), { evidenceType: 'review' });
  const orchestrator = { route: (input) => ({ input, depth: 'engineer', contextSources: [], agents: ['implementer','reviewer'], tools: ['tests','security','review'], requiresApproval: false, requiresVerification: true, executionLevel: 'WORKSPACE_EXECUTE' }) };
  const runtime = new EngineeringRuntime({ orchestrator, modelRuntime, tools, qualificationGate: new QualificationGate({ required: ['tests','security','review'] }) });
  const result = await runtime.run('Implement the feature');
  assert.equal(result.status, 'completed');
  assert.equal(result.workOrder.status, 'passed');
  assert.equal(result.verificationPack.qualification.ok, true);
  assert.equal(result.verificationClaim.status, 'verified');
  assert.equal(result.cycle.stage, 'preserve');
  assert.equal(runtime.knowledge.get(`work-order:${result.workOrder.id}`).state, 'verified');
});

test('EngineeringRuntime refuses verified completion when independent verification is absent', async () => {
  const modelRuntime = new ModelRuntime();
  modelRuntime.register('local', { generate: async () => ({ text: 'looks done' }) });
  const orchestrator = { route: (input) => ({ input, depth: 'engineer', contextSources: [], agents: [], tools: [], requiresApproval: false, requiresVerification: true }) };
  const runtime = new EngineeringRuntime({ orchestrator, modelRuntime });
  const result = await runtime.run('Make a risky change');
  assert.equal(result.status, 'verification-required');
  assert.equal(result.workOrder.status, 'failed');
  assert.equal(result.verificationClaim.status, 'unverified');
  assert.deepEqual(result.qualification.missing, ['independent-verification']);
});
