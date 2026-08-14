import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parse as parseScout, validate as validateScout } from '../../Scout/src/index.js';
import { buildTarget, executeTarget } from '../../Cannon/src/index.js';
import { check as checkCannonPlus, Region } from '../../Cannon-Plus/src/index.js';
import { parseNovaSource, analyzeProgram, lowerToIR, buildDebugMetadata, verifyDebugMetadata } from '../../Nova/src/index.js';
import * as Parallel from '../../Parallel/src/index.js';
import { CadenceApp, createParallelServer } from '../../Cadence/src/index.js';
import { h, renderToString } from '../../Sprout/src/index.js';
import { open as openSyncio } from '../../Syncio/src/index.js';
import { AdapterRegistry } from '../../Plasma/src/index.js';
import { pythonAdapter } from '../../Plasma/src/adapters.js';
import { scaffoldPlatformProject } from '../../Velocity/src/platform-projects.js';
import { createArtifact, ReleaseStore } from '../../Chronos/src/index.js';
import { SigningVault, createSignedBuild, canonicalSigningPayload } from '../../Chronos/src/cloud.js';
import { ProcessTerminalAdapter, StdioLanguageClient } from '../src/process-integration.js';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'cannon-ecosystem-'));
const proof = { protocol: 'cannon-ecosystem-proof/1', stages: [] };
const stage = (name, data = {}) => { proof.stages.push({ name, ...data }); console.log(`✓ ${name}`); };

// 1. Scout is the authoritative configuration input.
const scoutSource = '{"app":"vertical-proof","target":"native","runtime":"parallel","value":42}';
const scoutDoc = parseScout(scoutSource);
const scoutValidation = validateScout(scoutDoc.value, {
  type: 'object',
  required: ['app','target','runtime','value'],
  properties: {
    app: { type: 'string' },
    target: { enum: ['native'] },
    runtime: { enum: ['parallel'] },
    value: { type: 'number' }
  },
  additionalProperties: false
});
assert.equal(scoutValidation.ok, true, JSON.stringify(scoutValidation.issues));
stage('Scout configuration', { target: scoutDoc.value.target, value: scoutDoc.value.value });

// 2. Cannon executes a real program on the native C target.
const cannonSource = `fn add(a, b) {\n  return a + b\n}\nvalue = add(20, 22)\nprint(value)\n`;
const cannonBuild = await buildTarget(cannonSource, scoutDoc.value.target, { outDir: path.join(workspace,'cannon'), appName: scoutDoc.value.app });
const cannonExecution = await executeTarget(cannonBuild);
assert.equal(cannonExecution.ok, true, cannonExecution.stderr ?? cannonExecution.compile?.stderr);
const value = Number(cannonExecution.stdout.trim());
assert.equal(value, scoutDoc.value.value);
stage('Cannon native execution', { manifest: cannonBuild.manifest.protocol, value });

// 3. Cannon+ proves the strict systems boundary over the same value.
const strict = checkCannonPlus(`let value: i32 = ${value}`);
assert.equal(strict.types.value, 'i32');
const region = new Region({ name: 'vertical', capacity: 16 });
const allocation = region.allocate(4, value);
assert.equal(allocation.read(), value);
const memorySnapshot = region.snapshot();
assert.equal(memorySnapshot.used, 4);
allocation.release();
region.close();
stage('Cannon+ safety boundary', { type: strict.types.value, memoryUsed: memorySnapshot.used });

// 4. Nova analyzes, lowers, and emits debugger metadata with exact source provenance.
const novaSource = `let value = ${value}\nprint(value)`;
const parsed = parseNovaSource(novaSource, { file: 'vertical.cannon' });
const analysis = analyzeProgram(parsed);
assert.equal(analysis.ok, true, JSON.stringify(analysis.diagnostics));
const ir = lowerToIR(parsed, analysis);
const debugMetadata = buildDebugMetadata(ir, { file: 'vertical.cannon' });
assert.equal(verifyDebugMetadata(debugMetadata, ir).ok, true);
stage('Nova compile diagnostics metadata', { instructions: ir.instructions.length, debugDigest: debugMetadata.digest });

// 5 + 6. Cadence is served through the independent Parallel HTTP runtime.
const app = new CadenceApp();
app.get('/proof', async () => ({ value, debugDigest: debugMetadata.digest }));
const parallelServer = createParallelServer(app, Parallel);
await new Promise((resolve, reject) => { parallelServer.once('error', reject); parallelServer.listen(0, '127.0.0.1', resolve); });
const parallelAddress = parallelServer.address();
try {
  const response = await fetch(`http://127.0.0.1:${parallelAddress.port}/proof`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.value, value);
  assert.equal(payload.debugDigest, debugMetadata.digest);
  stage('Parallel runtime + Cadence backend', { port: parallelAddress.port });
} finally {
  await new Promise((resolve) => parallelServer.close(resolve));
}

// 7. Sprout renders the application state produced by the backend path.
const sproutHtml = renderToString(h('main', { 'data-proof': debugMetadata.digest }, h('strong', {}, `Value ${value}`)));
assert.match(sproutHtml, /Value 42/);
stage('Sprout application rendering', { htmlBytes: Buffer.byteLength(sproutHtml) });

// 8. Syncio durably stores the cross-layer application record and survives reopen.
const dbFile = path.join(workspace, 'syncio.json');
let db = await openSyncio(dbFile);
await db.collection('proofs').insert({ id: 'vertical', value, html: sproutHtml, debugDigest: debugMetadata.digest });
await db.close();
db = await openSyncio(dbFile);
const stored = db.collection('proofs').get('vertical');
assert.equal(stored.value, value);
assert.equal(stored.debugDigest, debugMetadata.digest);
await db.close();
stage('Syncio durable data', { recordId: stored.id });

// 9. Plasma crosses a real foreign-runtime boundary using Python.
const plasma = new AdapterRegistry();
plasma.register('python', pythonAdapter());
const plasmaResult = await plasma.invoke('python', { module: 'builtin', member: 'identity', args: [{ value: stored.value, digest: stored.debugDigest }] });
assert.equal(plasmaResult.ok, true, plasmaResult.error?.message);
assert.equal(plasmaResult.value.value, value);
assert.equal(plasmaResult.value.digest, debugMetadata.digest);
stage('Plasma Python interop', { adapter: plasmaResult.adapter });

// 10. Velocity generates a real desktop project; Cortex terminal control compiles and launches it.
const velocityRoot = path.join(workspace, 'velocity');
await scaffoldPlatformProject('desktop', velocityRoot, { name: 'VerticalProof' });
const terminal = new ProcessTerminalAdapter({ cwd: velocityRoot });
const compiled = await terminal.run('cc', ['main.c','-O2','-o','vertical-proof']);
assert.equal(compiled.ok, true, compiled.stderr);
const launched = await terminal.run('./vertical-proof');
assert.equal(launched.ok, true, launched.stderr);
assert.equal(launched.stdout.trim(), 'Velocity Desktop Ready');
stage('Velocity native build/orchestration', { output: launched.stdout.trim() });

// 11. Chronos signs the Velocity artifact and health-gates a deployment.
const desktopSource = await fs.readFile(path.join(velocityRoot,'main.c'),'utf8');
const artifact = createArtifact({ app: scoutDoc.value.app, version: '1.0.0', target: 'desktop', files: [{ path: 'main.c', content: desktopSource }], metadata: { debugDigest: debugMetadata.digest } });
const vault = new SigningVault();
vault.create('vertical-proof');
const signed = createSignedBuild({ artifact, keyName: 'vertical-proof', vault, platform: 'desktop' });
assert.equal(vault.verify('vertical-proof', canonicalSigningPayload(signed), signed.signature), true);
const releases = new ReleaseStore();
releases.putArtifact(artifact);
const release = releases.createRelease({ artifactDigest: artifact.digest, environment: { name: 'vertical-ci', strategy: 'canary', replicas: 2 }, actor: 'ecosystem-proof' });
releases.recordHealth(release.id, { healthy: true, healthyPercent: 100, details: { value } });
const promoted = releases.promote(release.id, 100);
assert.equal(promoted.status, 'active');
stage('Chronos sign + health-gated deploy', { artifactDigest: artifact.digest, releaseId: promoted.id });

// 12. Cortex observes the actual Scout and Nova language-server processes at the end of the chain.
const scoutClient = new StdioLanguageClient(process.execPath, [path.resolve('../../Scout/src/lsp-stdio.js')], { cwd: path.resolve('Cortex') });
const novaClient = new StdioLanguageClient(process.execPath, [path.resolve('../../Nova/src/lsp-stdio.js')], { cwd: path.resolve('Cortex') });
await scoutClient.start();
await novaClient.start();
try {
  const scoutInit = await scoutClient.request('textDocument/diagnostic', { textDocument: { uri: 'file:///vertical.scout' } }).catch(() => null);
  scoutClient.notify('textDocument/didOpen', { textDocument: { uri: 'file:///vertical.scout', languageId: 'scout', version: 1, text: scoutSource } });
  const scoutDiagnostics = await scoutClient.request('textDocument/diagnostic', { textDocument: { uri: 'file:///vertical.scout' } });
  assert.deepEqual(scoutDiagnostics.items ?? [], []);

  novaClient.notify('textDocument/didOpen', { textDocument: { uri: 'file:///vertical.cannon', languageId: 'cannon', version: 1, text: novaSource } });
  const novaDiagnostics = await novaClient.request('textDocument/diagnostic', { textDocument: { uri: 'file:///vertical.cannon' } });
  assert.deepEqual(novaDiagnostics.items ?? [], []);
  stage('Cortex observe/debug/manage', { scoutDiagnostics: 0, novaDiagnostics: 0 });
} finally {
  await scoutClient.close();
  await novaClient.close();
}

proof.ok = true;
proof.value = value;
proof.artifactDigest = artifact.digest;
proof.debugDigest = debugMetadata.digest;
await fs.writeFile(path.join(workspace, 'ecosystem-proof.json'), JSON.stringify(proof, null, 2));
assert.deepEqual(proof.stages.map((entry) => entry.name), [
  'Scout configuration',
  'Cannon native execution',
  'Cannon+ safety boundary',
  'Nova compile diagnostics metadata',
  'Parallel runtime + Cadence backend',
  'Sprout application rendering',
  'Syncio durable data',
  'Plasma Python interop',
  'Velocity native build/orchestration',
  'Chronos sign + health-gated deploy',
  'Cortex observe/debug/manage'
]);
console.log(JSON.stringify(proof, null, 2));
