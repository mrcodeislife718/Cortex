import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContainerAgentSandbox } from '../src/agent-sandbox.js';

test('container sandbox enforces read-only workspace and disabled network', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-sandbox-'));
  try {
    await fs.writeFile(path.join(root, 'input.txt'), 'readable');
    const sandbox = new ContainerAgentSandbox({ runtime: 'docker', image: 'node:24-alpine', defaultMemoryMb: 256, defaultCpu: 0.5, defaultPids: 32 });

    const read = await sandbox.run({ workspace: root, command: 'node', args: ['-e', "const fs=require('fs'); process.stdout.write(fs.readFileSync('/workspace/input.txt','utf8'))"] }, { timeoutMs: 30_000 });
    assert.equal(read.ok, true);
    assert.equal(read.stdout, 'readable');

    const write = await sandbox.run({ workspace: root, command: 'node', args: ['-e', "const fs=require('fs'); fs.writeFileSync('/workspace/blocked.txt','x')"] }, { timeoutMs: 30_000 });
    assert.equal(write.ok, false);
    await assert.rejects(fs.access(path.join(root, 'blocked.txt')));

    const network = await sandbox.run({ workspace: root, command: 'node', args: ['-e', "fetch('https://example.com').then(()=>process.exit(2)).catch(()=>process.exit(0))"] }, { timeoutMs: 30_000 });
    assert.equal(network.ok, true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
