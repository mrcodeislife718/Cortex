import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExtensionProcessHost, pickEnvironment } from '../src/extension-process-host.js';

test('extension process host scrubs ambient secrets and returns structured results', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-extension-host-'));
  const modulePath = path.join(root, 'extension.mjs');
  await fs.writeFile(modulePath, `export async function activate(payload){ return { payload, secret: process.env.CORTEX_TEST_SECRET ?? null, pid: process.pid }; }`);
  process.env.CORTEX_TEST_SECRET = 'must-not-leak';
  try {
    const host = new ExtensionProcessHost({ defaultTimeoutMs: 2000 });
    const result = await host.run({ modulePath, cwd: root, payload: { value: 7 } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.result.payload, { value: 7 });
    assert.equal(result.result.secret, null);
    assert.notEqual(result.result.pid, process.pid);
  } finally {
    delete process.env.CORTEX_TEST_SECRET;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('extension process host kills timed-out extension work', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-extension-timeout-'));
  const modulePath = path.join(root, 'extension.mjs');
  await fs.writeFile(modulePath, `export async function activate(){ await new Promise(r => setTimeout(r, 500)); return true; }`);
  try {
    const host = new ExtensionProcessHost({ defaultTimeoutMs: 30 });
    await assert.rejects(host.run({ modulePath, cwd: root }), /exceeded 30ms/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('extension process host terminates extensions exceeding output budget', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-extension-output-'));
  const modulePath = path.join(root, 'extension.mjs');
  await fs.writeFile(modulePath, `export async function activate(){ console.log('x'.repeat(20000)); await new Promise(r => setTimeout(r, 20)); return true; }`);
  try {
    const host = new ExtensionProcessHost({ defaultTimeoutMs: 2000, maxOutputBytes: 1024 });
    await assert.rejects(host.run({ modulePath, cwd: root }), /output exceeded/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('environment selection is explicit allowlist only', () => {
  const env = pickEnvironment({ PATH: '/bin', HOME: '/home/dev', TOKEN: 'secret' }, ['PATH']);
  assert.deepEqual(env, { PATH: '/bin' });
});
