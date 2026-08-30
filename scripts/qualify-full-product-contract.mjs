import fs from 'node:fs';

const contract = JSON.parse(fs.readFileSync(new URL('../architecture/full-product-contract.json', import.meta.url), 'utf8'));
const expectedAreas = [
  'real-repository-qualification','terminal-and-task-execution','language-intelligence','git-workflow','debugger','cortex-intelligence','agent-execution','extensions','system-graph','remote-and-container-development','performance-and-low-memory-qualification','security-qualification','desktop-polish','distribution','commercial-system','fresh-machine-final-qualification'
];
const expectedExecution = ['OBSERVE','PLAN','SAFE_EDIT','SANDBOX_EXECUTE','WORKSPACE_EXECUTE','PRIVILEGED','EXTERNAL_SIDE_EFFECT','PRODUCTION'];
const expectedChain = ['source','symbols','dependencies','build','runtime','memory','data','network','infrastructure','deployment','production-behavior'];
const failures = [];

for (const item of expectedAreas) if (!contract.completionAreas?.includes(item)) failures.push(`missing completion area: ${item}`);
for (const item of expectedExecution) if (!contract.executionLevels?.includes(item)) failures.push(`missing execution level: ${item}`);
for (const item of expectedChain) if (!contract.systemChain?.includes(item)) failures.push(`missing system-chain node: ${item}`);
if ((contract.superiorityLayers?.length || 0) < 35) failures.push('full superiority layer set is incomplete');
if (!String(contract.proofRule || '').includes('No superiority or completion claim')) failures.push('proof-before-claim rule is missing');
if (!contract.scaleRule?.includes('100x') || !contract.scaleRule?.includes('success-too-well')) failures.push('scale qualification must include 100x and success-too-well');
if (!contract.finalGate?.includes('fresh-machine') || !contract.finalGate?.includes('update')) failures.push('fresh-machine final gate is incomplete');

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, contract: 'cortex-full-product-v1', completionAreas: contract.completionAreas.length, superiorityLayers: contract.superiorityLayers.length }, null, 2));
