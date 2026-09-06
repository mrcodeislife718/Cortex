import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExtensionProcessHost } from '../src/extension-process-host.js';

test('Cortex extension host does not complete until the single-shot worker is reaped', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-extension-reap-'));
  const modulePath = path.join(root, 'extension.mjs');
  await fs.writeFile(modulePath, `export async function activate(){ return { ok: true }; }`);
  try {
    const host = new ExtensionProcessHost({ defaultTimeoutMs: 2000 });
    const result = await host.run({ modulePath, cwd: root });
    assert.equal(result.ok, true);
    assert.deepEqual(result.result, { ok: true });
    assert.deepEqual(result.exit, { code: 0, signal: null });
    assert.equal(result.forcedTermination, false);
    assert.throws(() => process.kill(result.pid, 0), (error) => error?.code === 'ESRCH');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Cortex extension host validates lifecycle bounds before creating child processes', () => {
  assert.throws(() => new ExtensionProcessHost({ defaultTimeoutMs: 0 }), /positive integer/);
  assert.throws(() => new ExtensionProcessHost({ maxOutputBytes: 0 }), /positive integer/);
  assert.throws(() => new ExtensionProcessHost({ maxOldSpaceMb: 0 }), /positive integer/);
  assert.throws(() => new ExtensionProcessHost({ terminalExitGraceMs: 0 }), /positive integer/);
});
