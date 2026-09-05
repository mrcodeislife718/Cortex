import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ExtensionContainerHost } from '../src/extension-container-host.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-extension-sandbox-'));
  const extension = path.join(root, 'extension');
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(extension); await fs.mkdir(workspace);
  await fs.writeFile(path.join(workspace, 'input.txt'), 'visible');
  t.after(() => fs.rm(root, { recursive:true, force:true }));
  return { root, extension, workspace };
}

test('untrusted extension runs in a real read-only, network-denied container boundary', async (t) => {
  const { extension, workspace } = await fixture(t);
  await fs.writeFile(path.join(extension, 'main.mjs'), `import fs from 'node:fs/promises';\nexport async function activate(payload, ctx){\n const input=await fs.readFile(ctx.workspace+'/input.txt','utf8');\n let writeBlocked=false; try{await fs.writeFile(ctx.workspace+'/blocked.txt','x')}catch{writeBlocked=true}\n let networkBlocked=false; try{await fetch('https://example.com');}catch{networkBlocked=true}\n return {input,writeBlocked,networkBlocked,payload};\n}\n`);
  const host = new ExtensionContainerHost({ runtime:'docker', image:'node:24-alpine', memoryMb:192, cpu:0.5, pids:32 });
  const result = await host.run({ extensionRoot:extension, modulePath:'main.mjs', workspace, payload:{ id:42 } }, { timeoutMs:30_000 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { input:'visible', writeBlocked:true, networkBlocked:true, payload:{ id:42 } });
  await assert.rejects(fs.access(path.join(workspace,'blocked.txt')));
});

test('writable workspace is explicit and extension package remains read-only', async (t) => {
  const { extension, workspace } = await fixture(t);
  await fs.writeFile(path.join(extension, 'main.mjs'), `import fs from 'node:fs/promises';\nexport async function activate(){\n await fs.writeFile('/workspace/output.txt','created');\n let extensionWriteBlocked=false; try{await fs.writeFile('/extension/mutated.txt','bad')}catch{extensionWriteBlocked=true}\n return {extensionWriteBlocked};\n}\n`);
  const host = new ExtensionContainerHost({ runtime:'docker', image:'node:24-alpine', memoryMb:192, cpu:0.5, pids:32 });
  const result = await host.run({ extensionRoot:extension, modulePath:'main.mjs', workspace, writableWorkspace:true }, { timeoutMs:30_000 });
  assert.equal(result.result.extensionWriteBlocked, true);
  assert.equal(await fs.readFile(path.join(workspace,'output.txt'),'utf8'), 'created');
  await assert.rejects(fs.access(path.join(extension,'mutated.txt')));
});

test('extension module symlink escape is rejected before container execution', async (t) => {
  const { root, extension, workspace } = await fixture(t);
  const outside = path.join(root, 'outside.mjs');
  await fs.writeFile(outside, 'export function activate(){}');
  await fs.symlink(outside, path.join(extension,'escape.mjs'));
  const host = new ExtensionContainerHost();
  await assert.rejects(() => host.commandSpec({ extensionRoot:extension, modulePath:'escape.mjs', workspace }), /escapes extension root/);
});
