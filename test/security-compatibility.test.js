import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExtensionPlatform, ExtensionRuntime } from '../src/extension-platform.js';
import { ExtensionProcessHost } from '../src/extension-process-host.js';
import { CapabilitySecurityKernel } from '../src/security-kernel.js';
import { VsCodeExtensionAdapter } from '../src/vscode-compatibility.js';
import { ContainerAgentSandbox, SandboxPolicy } from '../src/agent-sandbox.js';

test('extension platform executes native extension in a separate scrubbed process', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-isolated-platform-'));
  try {
    const modulePath = path.join(root, 'extension.mjs');
    await fs.writeFile(modulePath, `export async function activate(payload){ return { value: payload.value + 1, pid: process.pid, leaked: process.env.CORTEX_PRIVATE ?? null }; }`);
    process.env.CORTEX_PRIVATE = 'secret';
    const security = new CapabilitySecurityKernel();
    const host = new ExtensionProcessHost({ defaultTimeoutMs: 2000 });
    const platform = new ExtensionPlatform({ securityKernel: security, processHost: host });
    platform.install({ id: 'native.isolated', version: '1.0.0', runtime: ExtensionRuntime.WORKSPACE, activationEvents: ['onCommand:run'], capabilities: ['read.workspace'], executionLevel: 'OBSERVE', budgets: { activationMs: 2000 } });
    const token = security.issue({ subject: 'extension:native.isolated', capabilities: ['read.workspace'], maxExecutionLevel: 'OBSERVE' });
    const result = await platform.activateIsolated('native.isolated', { event: 'onCommand:run', runtime: ExtensionRuntime.WORKSPACE, token: token.id, modulePath, cwd: root, payload: { value: 4 } });
    assert.equal(result.value, 5);
    assert.equal(result.leaked, null);
    assert.notEqual(result.pid, process.pid);
    assert.ok(platform.health('native.isolated').lastProcessId);
  } finally {
    delete process.env.CORTEX_PRIVATE;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('VS Code compatibility translates supported contribution value without copying ambient authority', () => {
  const adapter = new VsCodeExtensionAdapter();
  const manifest = adapter.translate({
    name: 'example', publisher: 'acme', version: '1.2.3', main: './extension.js', engines: { vscode: '^1.100.0' },
    activationEvents: ['onLanguage:javascript', 'onCommand:acme.run'],
    contributes: {
      languages: [{ id: 'javascript' }],
      commands: [{ command: 'acme.run', title: 'Run' }],
      configuration: { properties: { 'acme.enabled': { type: 'boolean', default: true } } },
    },
  });
  assert.equal(manifest.id, 'acme.example');
  assert.deepEqual(manifest.contributions.languages, ['javascript']);
  assert.deepEqual(manifest.contributions.commands, ['acme.run']);
  assert.ok(manifest.capabilities.includes('read.workspace'));
  assert.ok(manifest.capabilities.includes('execute.extension-node'));
  assert.ok(!manifest.capabilities.includes('*'));
});

test('VS Code compatibility rejects unsupported contribution surfaces by default', () => {
  const adapter = new VsCodeExtensionAdapter();
  assert.throws(() => adapter.translate({ name: 'bad', publisher: 'acme', version: '1', contributes: { customEditors: [{ viewType: 'x' }] } }), /unsupported contributions: customEditors/);
});

test('agent sandbox is network-off, read-only, capability-dropped and resource-bounded by default', () => {
  const sandbox = new ContainerAgentSandbox({ runtime: 'docker', image: 'node:24-alpine' });
  const spec = sandbox.commandSpec({ workspace: '/workspace/project', command: 'node', args: ['test.js'] });
  assert.equal(spec.command, 'docker');
  assert.ok(spec.args.includes('no-new-privileges'));
  assert.ok(spec.args.includes('ALL'));
  assert.ok(spec.args.includes('--read-only'));
  assert.ok(spec.args.includes('none'));
  assert.ok(spec.args.includes('--memory'));
  assert.ok(spec.args.includes('--pids-limit'));
  assert.equal(spec.args.at(-2), 'node');
  assert.equal(spec.args.at(-1), 'test.js');
});

test('sandbox policy denies network and excessive resources', () => {
  const policy = new SandboxPolicy({ allowedImages: ['node:24-alpine'], maxMemoryMb: 512, maxCpu: 1, maxPids: 64, allowNetwork: false });
  const decision = policy.evaluate({ memoryMb: 1024, cpu: 2, pids: 128, network: true }, 'node:24-alpine');
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.reasons.sort(), ['cpu-limit-exceeded', 'memory-limit-exceeded', 'network-not-allowed', 'pid-limit-exceeded']);
});
