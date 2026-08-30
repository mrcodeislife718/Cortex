import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const contractPath = path.resolve(process.cwd(), 'architecture/superiority-contract.json');
const raw = fs.readFileSync(contractPath, 'utf8');
const contract = JSON.parse(raw);

const failures = [];
const requiredInnovationFields = [
  'id',
  'purpose',
  'mechanism',
  'expectedAdvantage',
  'tradeoff',
  'failureMode',
  'measurementMethod',
  'benchmark',
  'fallback',
  'validationExperiment',
  'scale',
];
const requiredScales = ['1x', '10x', '100x'];
const requiredCompetitorFields = [
  'name',
  'strengths',
  'weaknesses',
  'preserveOrExceed',
  'structurallyEliminate',
  'sources',
];
const expectedCompetitors = ['VS Code', 'Cursor', 'JetBrains', 'Zed', 'Replit'];
const expectedPrinciples = [
  'compatibility-at-the-edge-independent-internals',
  'ai-proposes-evidence-and-policy-authorize',
  'intent-first-no-artificial-ai-modes',
  'capability-separated-from-authority',
  'system-graph-is-foundational',
  'model-independent-by-default',
  'local-failure-not-global-failure',
  'power-underneath-simplicity-on-top',
  'technical-superiority-requires-comparative-evidence',
];

function nonEmpty(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0 && value.every(nonEmpty);
  return value !== null && typeof value === 'object' && Object.keys(value).length > 0;
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

assert(contract.product === 'Cortex', 'contract.product must be Cortex');
assert(Array.isArray(contract.systemChain) && contract.systemChain.length >= 11, 'systemChain must span source through production behavior');
assert(contract.systemChain?.[0] === 'source', 'systemChain must begin at source');
assert(contract.systemChain?.at(-1) === 'production-behavior', 'systemChain must end at production-behavior');

for (const principle of expectedPrinciples) {
  assert(contract.principles?.includes(principle), `missing architecture principle: ${principle}`);
}

for (const competitorName of expectedCompetitors) {
  const competitor = contract.competitors?.find((entry) => entry.name === competitorName);
  assert(Boolean(competitor), `missing competitor: ${competitorName}`);
  if (!competitor) continue;
  for (const field of requiredCompetitorFields) {
    assert(nonEmpty(competitor[field]), `${competitorName} missing ${field}`);
  }
  for (const source of competitor.sources ?? []) {
    assert(/^https:\/\//.test(source), `${competitorName} source must be HTTPS: ${source}`);
  }
}

const innovationIds = new Set();
for (const innovation of contract.innovations ?? []) {
  for (const field of requiredInnovationFields) {
    assert(nonEmpty(innovation[field]), `${innovation.id ?? 'unknown innovation'} missing ${field}`);
  }
  assert(!innovationIds.has(innovation.id), `duplicate innovation id: ${innovation.id}`);
  innovationIds.add(innovation.id);
  for (const scale of requiredScales) {
    assert(nonEmpty(innovation.scale?.[scale]), `${innovation.id} missing ${scale} consequence analysis`);
  }
  for (const [metric, value] of Object.entries(innovation.benchmark ?? {})) {
    assert(typeof value === 'number' && Number.isFinite(value), `${innovation.id} benchmark ${metric} must be numeric`);
  }
}

assert((contract.innovations?.length ?? 0) >= 8, 'at least eight core architectural innovations must be qualified');
assert((contract.requiredBenchmarkDimensions?.length ?? 0) >= 18, 'benchmark dimensions are incomplete');
assert(/comparative evidence/i.test(contract.qualificationRule ?? ''), 'qualificationRule must require comparative evidence');
assert(/missing evidence/i.test(contract.qualificationRule ?? ''), 'qualificationRule must define missing evidence as unqualified');

if (failures.length) {
  console.error('Cortex architecture superiority qualification FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  competitors: contract.competitors.length,
  innovations: contract.innovations.length,
  benchmarkDimensions: contract.requiredBenchmarkDimensions.length,
  scales: requiredScales,
  rule: contract.qualificationRule,
}, null, 2));
