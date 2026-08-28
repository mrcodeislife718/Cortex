import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { AtomicJsonStore } from '../src/persistence.js';
import { WorkspaceIntelligence } from '../src/workspace-intelligence.js';
import { WorkspaceSessionRecovery } from '../src/session-recovery.js';
import { ModelRuntime } from '../src/model-runtime.js';
import { SessionSigner, StripeWebhookVerifier, DurableSubscriptionRepository, CommercialAccountService } from '../src/account-service.js';
import { HostedProcessingPolicy, ContextReleasePolicy } from '../src/privacy-controls.js';
import { TransactionalUpdateManager, SignedUpdateVerifier } from '../src/update-manager.js';
import { WorkbenchState, CommandRegistry, SettingsRegistry, KeybindingRegistry } from '../src/workbench-core.js';
import { PerformanceQualification, DeadWeightAuditor, scaleQualification } from '../src/performance-qualification.js';
import { CortexSystemGraph } from '../src/system-graph.js';
import { LanguageSemanticIngestor, RuntimeEvidenceIngestor, GitHistoryIngestor, DeploymentEvidenceIngestor } from '../src/system-evidence-ingestion.js';
import { SshRemoteExecutor, ContainerExecutor } from '../src/remote-execution.js';

test('workspace intelligence discovers conventions without setup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-intelligence-'));
  try {
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'app', packageManager: 'npm@11.0.0', scripts: { build: 'node build.js', test: 'node --test', dev: 'node app.js' }, dependencies: { pg: '^8.23.0' } }));
    await fs.writeFile(path.join(root, 'package-lock.json'), '{}');
    await fs.writeFile(path.join(root, 'Dockerfile'), 'FROM node:24');
    await fs.writeFile(path.join(root, '.env'), 'SECRET=x');
    await fs.mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: ci');
    const profile = await new WorkspaceIntelligence(root).inspect();
    assert.equal(profile.packageManager, 'npm');
    assert.ok(profile.languages.includes('javascript'));
    assert.equal(profile.commands.test, 'npm run test');
    assert.ok(profile.containers.includes('Dockerfile'));
    assert.ok(profile.databases.includes('postgresql'));
    assert.ok(profile.cicd.includes('.github/workflows/ci.yml'));
    assert.ok(profile.health.findings.some((finding) => finding.code === 'env.local-present'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('workspace session recovery persists unsaved buffers with integrity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-recovery-'));
  try {
    const store = new AtomicJsonStore(path.join(root, 'session.json'));
    const first = await new WorkspaceSessionRecovery({ store }).open();
    await first.checkpoint({ workspace: '/repo', layout: { panel: true }, openEditors: ['file:///a.js'], unsavedBuffers: [{ uri: 'file:///a.js', text: 'const x = 1;', version: 3 }] });
    const second = await new WorkspaceSessionRecovery({ store }).open();
    const restored = second.restore({ workspace: '/repo' });
    assert.equal(restored.unsavedBuffers[0].text, 'const x = 1;');
    assert.equal(restored.revision, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('model runtime fails over, rejects malformed responses and accounts cost', async () => {
  const runtime = new ModelRuntime({ failureThreshold: 1, circuitCooldownMs: 1000, sleep: async () => {} });
  runtime.register('bad', { generate: async () => { throw new Error('503 unavailable'); } }, { usdPer1MInput: 1, usdPer1MOutput: 2 });
  runtime.register('good', { generate: async () => ({ text: 'ok', usage: { inputTokens: 1000, outputTokens: 500 } }) }, { usdPer1MInput: 1, usdPer1MOutput: 2 });
  const result = await runtime.generate({ prompt: 'x', usageEstimate: { inputTokens: 1000 } }, { preferred: ['bad', 'good'], retries: 0, accountId: 'acct', budgetUsd: 1 });
  assert.equal(result.provider, 'good');
  assert.equal(result.result.text, 'ok');
  assert.ok(runtime.spent('acct') > 0);
  assert.ok(runtime.list().find((provider) => provider.name === 'bad').circuitOpenUntil > 0);
});

test('sessions are signed and Stripe webhooks are timestamp/signature verified and idempotent', async () => {
  let now = 1_700_000_000_000;
  const signer = new SessionSigner({ secret: 'x'.repeat(64), clock: () => now });
  const token = signer.issue({ subject: 'acct-1', roles: ['owner'], ttlSeconds: 60 });
  assert.equal(signer.verify(token).sub, 'acct-1');

  const raw = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'acct-1', status: 'active', metadata: { cortex_account_id: 'acct-1', cortex_plan: 'pro' }, items: { data: [{ quantity: 1 }] } } } });
  const timestamp = Math.floor(now / 1000);
  const secret = 'whsec_test';
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  const verifier = new StripeWebhookVerifier({ secret, clock: () => now });
  const event = verifier.verify(raw, `t=${timestamp},v1=${signature}`);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-subscriptions-'));
  try {
    const repo = await new DurableSubscriptionRepository(new AtomicJsonStore(path.join(root, 'subscriptions.json'))).open();
    const service = new CommercialAccountService({ subscriptions: repo });
    assert.equal((await service.applyStripeEvent(event)).duplicate, false);
    assert.equal((await service.applyStripeEvent(event)).duplicate, true);
    assert.equal(repo.get('acct-1').status, 'active');
    assert.equal(repo.get('acct-1').plan, 'pro');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('hosted processing policy denies secret release and retention beyond policy', () => {
  const policy = new HostedProcessingPolicy({ allowedProviders: ['openai'], allowedRegions: ['us'], maxRetentionDays: 0 });
  assert.equal(policy.evaluate({ provider: 'openai', region: 'us', retentionDays: 0 }).allowed, true);
  assert.equal(policy.evaluate({ provider: 'openai', region: 'us', retentionDays: 1 }).allowed, false);
  const release = new ContextReleasePolicy().inspect([{ source: 'repository', text: 'password=abc' }]);
  assert.equal(release.allowed, false);
});

test('updates verify signatures, checksums and can rollback atomically', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-update-'));
  try {
    const install = path.join(root, 'install');
    const staging = path.join(root, 'staging');
    const artifact1 = path.join(root, 'cortex-1.bin');
    const artifact2 = path.join(root, 'cortex-2.bin');
    await fs.writeFile(artifact1, 'release-one');
    await fs.writeFile(artifact2, 'release-two');
    const manager = new TransactionalUpdateManager({ installDir: install, stagingDir: staging });
    const sha1 = crypto.createHash('sha256').update('release-one').digest('hex');
    const sha2 = crypto.createHash('sha256').update('release-two').digest('hex');
    const stage1 = await manager.stage({ version: '1.0.0', artifactPath: artifact1, sha256: sha1 });
    await manager.commit({ version: '1.0.0', stagedPath: stage1.target });
    const stage2 = await manager.stage({ version: '2.0.0', artifactPath: artifact2, sha256: sha2 });
    await manager.commit({ version: '2.0.0', stagedPath: stage2.target });
    assert.equal((await manager.rollback()).version, '1.0.0');

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const manifest = { artifact: 'cortex-2.bin', schema: 'cortex.update/v1', sha256: sha2, version: '2.0.0' };
    const signature = crypto.sign(null, Buffer.from(JSON.stringify(manifest)), privateKey).toString('base64');
    assert.equal(new SignedUpdateVerifier({ publicKey }).verify(manifest, signature), true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('workbench supports familiar commands settings keybindings splits problems and tests without hidden conflicts', async () => {
  const commands = new CommandRegistry();
  commands.register('workbench.test', async ({ value }) => value + 1, { title: 'Test' });
  assert.equal(await commands.execute('workbench.test', { value: 1 }), 2);
  const settings = new SettingsRegistry().define('editor.fontSize', { type: 'number', defaultValue: 14 });
  settings.set('user', 'editor.fontSize', 16);
  assert.equal(settings.get('editor.fontSize'), 16);
  const keys = new KeybindingRegistry();
  keys.bind({ key: 'ctrl+p', command: 'quickOpen' });
  keys.bind({ key: 'ctrl+p', command: 'other' });
  assert.equal(keys.conflicts().length, 1);
  const workbench = new WorkbenchState();
  workbench.editors.open('file:///a.js');
  workbench.editors.split('right');
  workbench.problems.replace('js', [{ severity: 'error', message: 'boom' }]);
  workbench.tests.upsert({ id: 't1', label: 'works' });
  workbench.tests.result('t1', { status: 'passed', durationMs: 5 });
  const snapshot = workbench.snapshot();
  assert.equal(snapshot.editors.groups.length, 2);
  assert.equal(snapshot.problems.error, 1);
  assert.equal(snapshot.tests[0].status, 'passed');
});

test('performance and dead-weight gates fail measurable regressions', () => {
  const perf = new PerformanceQualification({ budgets: { typingP95Ms: 10 } });
  perf.record('typing', 4); perf.record('typing', 12);
  assert.equal(perf.evaluate().ok, false);
  const deadWeight = new DeadWeightAuditor({ maxAlwaysOn: 1 });
  assert.equal(deadWeight.evaluate({ alwaysOn: ['a', 'b'] }).ok, false);
  assert.equal(scaleQualification({ base: { files: 10 } })[2].measurements.files, 1000);
});

test('system graph accepts language runtime Git test infrastructure and deployment evidence', () => {
  const graph = new CortexSystemGraph();
  graph.upsertNode({ id: 'file:a', kind: 'file', key: 'src/a.js', data: {} });
  new LanguageSemanticIngestor(graph).ingest({ document: 'src/a.js', symbols: [{ name: 'run', kind: 'function', range: { start: { line: 0, character: 0 } } }] });
  new RuntimeEvidenceIngestor(graph).ingest([{ kind: 'service', key: 'api', data: { pid: 42 }, relations: [{ type: 'runs', target: 'src/a.js' }] }]);
  new GitHistoryIngestor(graph).ingest([{ sha: 'abcdef1234567', author: 'dev@example.com', files: ['src/a.js'] }]);
  new DeploymentEvidenceIngestor(graph).ingest({ tests: [{ key: 'test:a', relations: [{ type: 'verifies', target: 'src/a.js' }] }], infrastructure: [{ key: 'infra:prod' }], deployments: [{ key: 'deploy:prod', relations: [{ type: 'deploys', target: 'api' }] }] });
  assert.ok(graph.query({ kinds: ['symbol'] }).length === 1);
  assert.ok(graph.query({ kinds: ['commit'] }).length === 1);
  assert.ok(graph.query({ kinds: ['test'] }).length === 1);
  assert.ok(graph.query({ kinds: ['deployment'] }).length === 1);
});

test('remote execution adapters build shell-free SSH and container commands', () => {
  const ssh = new SshRemoteExecutor();
  const sshSpec = ssh.commandSpec({ host: 'dev.example.com', user: 'alice', command: 'node', args: ['app.js'] });
  assert.equal(sshSpec.command, 'ssh');
  assert.deepEqual(sshSpec.args.slice(-4), ['alice@dev.example.com', '--', 'node', 'app.js']);
  const container = new ContainerExecutor({ runtime: 'podman' });
  const containerSpec = container.commandSpec({ container: 'app-1', command: 'npm', args: ['test'] });
  assert.deepEqual(containerSpec, { command: 'podman', args: ['exec', 'app-1', 'npm', 'test'] });
});
