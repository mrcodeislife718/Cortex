import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ComparativeQualification } from '../src/performance-qualification.js';

test('architecture superiority contract contains the complete evidence schema', () => {
  const contract = JSON.parse(fs.readFileSync(new URL('../architecture/superiority-contract.json', import.meta.url), 'utf8'));
  assert.equal(contract.product, 'Cortex');
  assert.equal(contract.systemChain[0], 'source');
  assert.equal(contract.systemChain.at(-1), 'production-behavior');
  assert.ok(contract.innovations.length >= 8);
  for (const innovation of contract.innovations) {
    for (const field of ['purpose', 'mechanism', 'expectedAdvantage', 'tradeoff', 'failureMode', 'measurementMethod', 'benchmark', 'fallback', 'validationExperiment']) {
      assert.ok(innovation[field], `${innovation.id} missing ${field}`);
    }
    assert.ok(innovation.scale['1x']);
    assert.ok(innovation.scale['10x']);
    assert.ok(innovation.scale['100x']);
  }
});

test('Cortex cannot claim superiority without fresh comparative evidence', () => {
  const now = Date.UTC(2026, 7, 30);
  const qualification = new ComparativeQualification({ maxEvidenceAgeMs: 7 * 24 * 60 * 60 * 1000, clock: () => now });
  assert.throws(() => qualification.compare({ dimension: 'memory', metric: 'idle-rss-mb', cortex: 220, competitor: 500 }), /evidence source/);

  const fresh = qualification.compare({
    dimension: 'memory',
    metric: 'idle-rss-mb',
    cortex: 220,
    competitor: 500,
    direction: 'lower',
    minimumImprovementPct: 20,
    measuredAt: now,
    evidence: { source: 'benchmark-run-123', competitor: 'Electron reference shell' },
  });
  assert.equal(fresh.status, 'SUPERIOR');
  assert.ok(fresh.improvementPct > 50);
  assert.equal(qualification.evaluate({ requiredDimensions: ['memory'] }).ok, true);
});

test('stale or losing measurements are never reported as superior', () => {
  const now = Date.UTC(2026, 7, 30);
  const qualification = new ComparativeQualification({ maxEvidenceAgeMs: 24 * 60 * 60 * 1000, clock: () => now });
  const stale = qualification.compare({
    dimension: 'latency',
    metric: 'cold-start-ms',
    cortex: 1000,
    competitor: 1500,
    direction: 'lower',
    minimumImprovementPct: 10,
    measuredAt: now - 2 * 24 * 60 * 60 * 1000,
    evidence: { source: 'old-run' },
  });
  assert.equal(stale.status, 'STALE_EVIDENCE');

  const losing = qualification.compare({
    dimension: 'memory',
    metric: 'active-rss-mb',
    cortex: 900,
    competitor: 700,
    direction: 'lower',
    measuredAt: now,
    evidence: { source: 'fresh-run' },
  });
  assert.equal(losing.status, 'NOT_SUPERIOR');
  assert.equal(qualification.evaluate({ requiredDimensions: ['latency', 'memory'] }).ok, false);
});
