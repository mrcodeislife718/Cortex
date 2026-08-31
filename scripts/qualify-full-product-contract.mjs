import fs from 'node:fs';

const contract = JSON.parse(fs.readFileSync(new URL('../architecture/full-product-contract.json', import.meta.url), 'utf8'));
const expectedAreas = [
  'freedom-first-non-repository-workflows','empty-window-and-untitled-editing','single-file-editing','greenfield-project-creation','existing-folder-project-and-repository-opening','multi-root-workspaces','complete-professional-editor-baseline','file-and-workspace-lifecycle','real-repository-qualification','terminal-and-task-execution','language-intelligence','optional-git-workflow','debugger','testing-workflow','cortex-intelligence','agent-execution','extensions','system-graph','remote-and-container-development','build-package-and-deploy-workflow','performance-and-low-memory-qualification','security-qualification','desktop-polish','distribution','commercial-system','fresh-machine-final-qualification'
];
const expectedExecution = ['OBSERVE','PLAN','SAFE_EDIT','SANDBOX_EXECUTE','WORKSPACE_EXECUTE','PRIVILEGED','EXTERNAL_SIDE_EFFECT','PRODUCTION'];
const expectedChain = ['source','symbols','dependencies','build','runtime','memory','data','network','infrastructure','deployment','production-behavior'];
const expectedEntryModes = ['empty-window','untitled-buffer','single-file','open-folder','multi-root-workspace','local-project','open-repository','clone-repository','remote-workspace','container-workspace','new-project'];
const expectedNonRepo = ['edit-without-git','run-without-git','debug-without-git','test-without-git','terminal-without-git','build-without-git','save-anywhere-with-permission','use-language-tools-without-git'];
const expectedFreedomGate = ['open-empty-window','create-untitled-file','edit-single-file-without-repository','save-as-without-repository','open-folder-without-git','terminal-without-git','debug-without-git','test-without-git'];
const failures = [];

for (const item of expectedAreas) if (!contract.completionAreas?.includes(item)) failures.push(`missing completion area: ${item}`);
for (const item of expectedExecution) if (!contract.executionLevels?.includes(item)) failures.push(`missing execution level: ${item}`);
for (const item of expectedChain) if (!contract.systemChain?.includes(item)) failures.push(`missing system-chain node: ${item}`);
for (const item of expectedEntryModes) if (!contract.workspaceLifecycle?.entryModes?.includes(item)) failures.push(`missing workspace entry mode: ${item}`);
for (const item of expectedNonRepo) if (!contract.workspaceLifecycle?.nonRepositoryWorkflow?.includes(item)) failures.push(`missing non-repository workflow: ${item}`);
for (const item of expectedFreedomGate) if (!contract.finalGate?.includes(item)) failures.push(`missing freedom final gate: ${item}`);
if (contract.workspaceLifecycle?.repositoryOptional !== true) failures.push('repositories must be optional');
if (contract.workspaceLifecycle?.gitOptional !== true) failures.push('Git must be optional');
if (contract.workspaceLifecycle?.accountOptionalForLocalDevelopment !== true) failures.push('accounts must be optional for local development');
if (contract.workspaceLifecycle?.projectManifestOptional !== true) failures.push('project manifests must be optional');
if (!String(contract.userExperience?.freedomRule || '').includes('must not require a repository')) failures.push('freedom rule must prohibit repository requirements');
if (!String(contract.workspaceLifecycle?.nonRegressionRule || '').includes('without Git')) failures.push('non-regression rule must preserve no-Git development');
if ((contract.superiorityLayers?.length || 0) < 35) failures.push('full superiority layer set is incomplete');
if (!String(contract.proofRule || '').includes('No superiority or completion claim')) failures.push('proof-before-claim rule is missing');
if (!contract.scaleRule?.includes('100x') || !contract.scaleRule?.includes('success-too-well')) failures.push('scale qualification must include 100x and success-too-well');
if (!contract.finalGate?.includes('fresh-machine') || !contract.finalGate?.includes('update')) failures.push('fresh-machine final gate is incomplete');

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, contract: 'cortex-full-product-v3-freedom-first', completionAreas: contract.completionAreas.length, superiorityLayers: contract.superiorityLayers.length, repositoryOptional: true }, null, 2));
