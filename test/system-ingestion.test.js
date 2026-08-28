import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceGraphIngestor, extractModuleSpecifiers } from '../src/system-ingestion.js';

test('module extraction covers ESM exports dynamic import and CommonJS', () => {
  const modules = extractModuleSpecifiers(`
    import fs from 'node:fs';
    import './local.js';
    export { x } from './exported.js';
    const lazy = import('./lazy.js');
    const old = require('@scope/pkg/subpath');
  `);
  assert.deepEqual(new Set(modules), new Set(['node:fs','./local.js','./exported.js','./lazy.js','@scope/pkg/subpath']));
});

test('workspace graph ingestion derives real files imports dependencies hashes and provenance', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cortex-ingestion-'));
  await fs.mkdir(path.join(root, 'src'));
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture-app', version: '1.0.0', type: 'module', dependencies: { lodash: '^4.17.21' }
  }), 'utf8');
  await fs.writeFile(path.join(root, 'src', 'util.js'), 'export const answer = 42;\n', 'utf8');
  await fs.writeFile(path.join(root, 'src', 'index.js'), "import { answer } from './util.js';\nimport lodash from 'lodash';\nexport default answer + Boolean(lodash);\n", 'utf8');
  await fs.writeFile(path.join(root, 'node_modules', 'ignored.js'), 'throw new Error("must not ingest");', 'utf8');

  const result = await new WorkspaceGraphIngestor(root).ingest();
  assert.equal(result.files, 2);

  const files = result.graph.query({ kinds: ['file'] });
  assert.deepEqual(files.map((file) => file.key).sort(), ['src/index.js','src/util.js']);
  assert.ok(files.every((file) => /^[a-f0-9]{64}$/.test(file.data.sha256)));
  assert.ok(files.every((file) => file.provenance.source === 'filesystem'));

  const packageNode = result.graph.query({ kinds: ['package'] })[0];
  assert.equal(packageNode.key, 'fixture-app');
  const lodashNode = result.graph.query({ kinds: ['dependency'], key: 'lodash' })[0];
  assert.equal(lodashNode.data.version, '^4.17.21');

  const indexNode = result.graph.query({ kinds: ['file'], key: 'src/index.js' })[0];
  const outgoing = result.graph.neighbors(indexNode.id, { direction: 'out', types: ['imports'] });
  assert.deepEqual(new Set(outgoing.map(({ node }) => node.key)), new Set(['src/util.js','lodash']));
});
