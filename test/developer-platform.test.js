import test from 'node:test';
import assert from 'node:assert/strict';
import { AssistantOrchestrator, AssistanceDepth } from '../src/assistant-orchestrator.js';
import { ExtensionPlatform, ExtensionRuntime } from '../src/extension-platform.js';
import { CapabilitySecurityKernel } from '../src/security-kernel.js';

test('assistant chooses depth without forcing user-facing modes', () => {
  const assistant = new AssistantOrchestrator();

  assert.equal(assistant.classifyIntent('Explain OAuth to me').depth, AssistanceDepth.EXPLAIN);
  assert.equal(assistant.classifyIntent('Fix this test').depth, AssistanceDepth.CHANGE);

  const production = assistant.route('Why did production fail after yesterday deployment?');
  assert.equal(production.depth, AssistanceDepth.ENGINEER);
  assert.equal(production.requiresPlan, true);
  assert.equal(production.requiresVerification, true);
  assert.equal(production.requiresApproval, true);
  assert.ok(production.contextSources.includes('runtime-evidence'));
  assert.ok(production.contextSources.includes('deployment-state'));
  assert.ok(production.contextSources.includes('git-history'));
  assert.ok(production.agents.includes('debugger'));
  assert.ok(production.agents.includes('release-engineer'));
});

test('extensions are lazy, capability scoped, runtime separated and observable', async () => {
  let now = 100;
  const security = new CapabilitySecurityKernel();
  const platform = new ExtensionPlatform({ securityKernel: security, clock: () => now, failureThreshold: 2 });
  platform.install({
    id: 'example.formatter',
    version: '1.0.0',
    runtime: ExtensionRuntime.WORKSPACE,
    activationEvents: ['onLanguage:javascript'],
    capabilities: ['read.workspace'],
    executionLevel: 'OBSERVE',
    compatibility: { vscode: true, apiVersion: '1' },
    contributions: { languages: ['javascript'] },
  });

  assert.equal(platform.health('example.formatter').activated, false);
  assert.deepEqual(platform.eligibleFor('onLanguage:javascript'), ['example.formatter']);

  await assert.rejects(
    platform.activate('example.formatter', {
      event: 'onLanguage:javascript', runtime: ExtensionRuntime.WORKSPACE, token: null, loader: async () => ({}),
    }),
    /security policy denied/,
  );

  const token = security.issue({ subject: 'extension:example.formatter', capabilities: ['read.workspace'], maxExecutionLevel: 'OBSERVE' });
  now = 125;
  const api = await platform.activate('example.formatter', {
    event: 'onLanguage:javascript', runtime: ExtensionRuntime.WORKSPACE, token: token.id, loader: async () => ({ format: true }),
  });
  assert.equal(api.format, true);
  assert.equal(platform.health('example.formatter').status, 'active');
  assert.equal(platform.health('example.formatter').lastActivationMs, 0);

  await assert.rejects(
    platform.activate('example.formatter', {
      event: 'onLanguage:javascript', runtime: ExtensionRuntime.UI, token: token.id, loader: async () => ({}),
    }),
    /requires workspace runtime/,
  );
});

test('repeated extension activation failures quarantine the extension', async () => {
  const platform = new ExtensionPlatform({ failureThreshold: 2 });
  platform.install({
    id: 'bad.extension', version: '1.0.0', runtime: ExtensionRuntime.UI,
    activationEvents: ['onStartup'], capabilities: [],
  });
  const fail = () => platform.activate('bad.extension', {
    event: 'onStartup', runtime: ExtensionRuntime.UI, loader: async () => { throw new Error('boom'); },
  });
  await assert.rejects(fail, /boom/);
  await assert.rejects(fail, /boom/);
  assert.equal(platform.health('bad.extension').status, 'quarantined');
  await assert.rejects(fail, /quarantined/);
});
