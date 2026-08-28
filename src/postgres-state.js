const clone = (value) => globalThis.structuredClone(value);

export const CortexPostgresMigrations = Object.freeze([
  {
    id: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS cortex_schema_migrations (
        id BIGINT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS cortex_state (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        revision BIGINT NOT NULL DEFAULT 0,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (namespace, key)
      );
      CREATE INDEX IF NOT EXISTS cortex_state_updated_at_idx ON cortex_state(updated_at);
    `,
  },
  {
    id: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS cortex_usage_events (
        id UUID PRIMARY KEY,
        account_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        quantity DOUBLE PRECISION NOT NULL CHECK (quantity >= 0),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS cortex_usage_account_metric_idx ON cortex_usage_events(account_id, metric, occurred_at);
    `,
  },
]);

export class PostgresStateStore {
  constructor({ pool, namespace = 'default' } = {}) {
    if (!pool || typeof pool.query !== 'function') throw new TypeError('PostgresStateStore requires a pg-compatible pool');
    this.pool = pool;
    this.namespace = namespace;
  }

  static async connect({ connectionString, namespace = 'default', pgModule = null, poolOptions = {} } = {}) {
    if (!connectionString) throw new Error('PostgreSQL connection string is required');
    const pg = pgModule ?? await import('pg');
    const Pool = pg.Pool ?? pg.default?.Pool;
    if (!Pool) throw new Error('pg module does not expose Pool');
    const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, ...poolOptions });
    return new PostgresStateStore({ pool, namespace });
  }

  async migrate() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS cortex_schema_migrations (id BIGINT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    for (const migration of CortexPostgresMigrations) {
      const existing = await this.pool.query('SELECT id FROM cortex_schema_migrations WHERE id = $1', [migration.id]);
      if (existing.rowCount) continue;
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query('INSERT INTO cortex_schema_migrations(id) VALUES($1)', [migration.id]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }
  }

  async load(key, { fallback = null } = {}) {
    const result = await this.pool.query('SELECT revision, value, updated_at FROM cortex_state WHERE namespace=$1 AND key=$2', [this.namespace, key]);
    if (!result.rowCount) return fallback === null ? null : { revision: 0, value: clone(fallback), updatedAt: null };
    const row = result.rows[0];
    return { revision: Number(row.revision), value: clone(row.value), updatedAt: row.updated_at };
  }

  async save(key, value, { expectedRevision = null } = {}) {
    if (!key) throw new Error('state key is required');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT revision FROM cortex_state WHERE namespace=$1 AND key=$2 FOR UPDATE', [this.namespace, key]);
      const currentRevision = locked.rowCount ? Number(locked.rows[0].revision) : 0;
      if (expectedRevision !== null && currentRevision !== expectedRevision) throw new OptimisticConcurrencyError(key, expectedRevision, currentRevision);
      const nextRevision = currentRevision + 1;
      await client.query(`
        INSERT INTO cortex_state(namespace, key, revision, value, updated_at)
        VALUES($1,$2,$3,$4::jsonb,now())
        ON CONFLICT(namespace,key) DO UPDATE SET revision=EXCLUDED.revision, value=EXCLUDED.value, updated_at=now()
      `, [this.namespace, key, nextRevision, JSON.stringify(value)]);
      await client.query('COMMIT');
      return { revision: nextRevision };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async delete(key, { expectedRevision = null } = {}) {
    if (expectedRevision === null) return (await this.pool.query('DELETE FROM cortex_state WHERE namespace=$1 AND key=$2', [this.namespace, key])).rowCount > 0;
    const result = await this.pool.query('DELETE FROM cortex_state WHERE namespace=$1 AND key=$2 AND revision=$3', [this.namespace, key, expectedRevision]);
    if (!result.rowCount) throw new OptimisticConcurrencyError(key, expectedRevision, null);
    return true;
  }

  async backup() {
    const result = await this.pool.query('SELECT key, revision, value, updated_at FROM cortex_state WHERE namespace=$1 ORDER BY key', [this.namespace]);
    return { schema: 'cortex.postgres-backup/v1', namespace: this.namespace, createdAt: new Date().toISOString(), rows: result.rows.map((row) => ({ key: row.key, revision: Number(row.revision), value: row.value, updatedAt: row.updated_at })) };
  }

  async restore(backup, { replace = false } = {}) {
    if (backup?.schema !== 'cortex.postgres-backup/v1' || backup.namespace !== this.namespace || !Array.isArray(backup.rows)) throw new Error('invalid PostgreSQL backup');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (replace) await client.query('DELETE FROM cortex_state WHERE namespace=$1', [this.namespace]);
      for (const row of backup.rows) {
        await client.query(`INSERT INTO cortex_state(namespace,key,revision,value,updated_at) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(namespace,key) DO UPDATE SET revision=EXCLUDED.revision,value=EXCLUDED.value,updated_at=EXCLUDED.updated_at`, [this.namespace, row.key, row.revision, JSON.stringify(row.value), row.updatedAt ?? new Date().toISOString()]);
      }
      await client.query('COMMIT');
      return { restored: backup.rows.length };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async close() { if (typeof this.pool.end === 'function') await this.pool.end(); }
}

export class OptimisticConcurrencyError extends Error {
  constructor(key, expected, actual) { super(`state revision conflict for ${key}: expected ${expected}, got ${actual}`); this.name = 'OptimisticConcurrencyError'; this.key = key; this.expected = expected; this.actual = actual; }
}
