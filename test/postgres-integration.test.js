import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresStateStore, OptimisticConcurrencyError } from '../src/postgres-state.js';

const connectionString = process.env.CORTEX_TEST_POSTGRES_URL;
if (!connectionString) throw new Error('CORTEX_TEST_POSTGRES_URL is required for PostgreSQL qualification');

test('PostgreSQL state migrates, rejects stale concurrent writes, backs up and restores', async () => {
  const namespace = `qualification-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const store = await PostgresStateStore.connect({ connectionString, namespace });
  try {
    await store.migrate();
    const first = await store.save('workspace', { version: 1 }, { expectedRevision: 0 });
    assert.equal(first.revision, 1);
    assert.deepEqual((await store.load('workspace')).value, { version: 1 });

    const writerA = store.save('workspace', { version: 2, writer: 'a' }, { expectedRevision: 1 });
    const writerB = store.save('workspace', { version: 2, writer: 'b' }, { expectedRevision: 1 });
    const results = await Promise.allSettled([writerA, writerB]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected.reason instanceof OptimisticConcurrencyError);

    const backup = await store.backup();
    assert.equal(backup.rows.length, 1);
    const current = await store.load('workspace');
    await store.delete('workspace', { expectedRevision: current.revision });
    assert.equal(await store.load('workspace'), null);
    assert.deepEqual(await store.restore(backup, { replace: true }), { restored: 1 });
    assert.deepEqual((await store.load('workspace')).value, backup.rows[0].value);
  } finally {
    await store.close();
  }
});
