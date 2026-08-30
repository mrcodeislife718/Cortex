import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

let injecting = false;
const observer = new MutationObserver(() => scheduleInject());
const side = document.getElementById('side-content');
if (side) observer.observe(side, { childList: true, subtree: true });
window.addEventListener('cortex-workspace-changed', () => scheduleInject());
window.addEventListener('cortex-git-clone', () => void cloneRepository());
scheduleInject();

function scheduleInject() {
  if (injecting) return;
  queueMicrotask(() => void injectGitControls());
}

async function injectGitControls() {
  if (document.getElementById('side-title')?.textContent !== 'SOURCE CONTROL') return;
  const host = document.getElementById('side-content');
  if (!host || host.querySelector('.cortex-git-workflows')) return;
  injecting = true;
  try {
    const section = document.createElement('section');
    section.className = 'cortex-git-workflows';
    section.style.cssText = 'display:grid;gap:6px;padding:8px;border-bottom:1px solid var(--border,#333)';
    section.innerHTML = `
      <div style="display:flex;gap:6px"><select id="git-branch-select" style="min-width:0;flex:1"></select><button id="git-new-branch" title="Create branch">＋</button></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px"><button id="git-fetch">Fetch</button><button id="git-pull">Pull</button><button id="git-push">Push</button><button id="git-history">History</button></div>
      <div id="git-operation-status" class="muted"></div>`;
    host.prepend(section);
    const select = section.querySelector('#git-branch-select');
    const branches = await invoke('git_branches').catch(() => []);
    for (const branch of branches) {
      const option = document.createElement('option'); option.value = branch.name; option.textContent = `${branch.current ? '● ' : ''}${branch.name}${branch.upstream ? ` → ${branch.upstream}` : ''}`; option.selected = Boolean(branch.current); select.append(option);
    }
    select.onchange = () => void gitOperation('Switch branch', 'git_switch_branch', { name: select.value }, { refresh: true });
    section.querySelector('#git-new-branch').onclick = () => void createBranch();
    section.querySelector('#git-fetch').onclick = () => void gitOperation('Fetch', 'git_fetch', {}, { refresh: true });
    section.querySelector('#git-pull').onclick = () => void gitOperation('Pull', 'git_pull', {}, { refresh: true });
    section.querySelector('#git-push').onclick = () => void gitOperation('Push', 'git_push', {}, { refresh: true });
    section.querySelector('#git-history').onclick = () => void showHistory();
  } finally { injecting = false; }
}

async function createBranch() {
  const name = prompt('New branch name')?.trim();
  if (!name) return;
  await gitOperation('Create branch', 'git_create_branch', { name }, { refresh: true });
}

async function gitOperation(label, command, args = {}, { refresh = false } = {}) {
  setOperation(`${label}…`);
  try {
    const result = await invoke(command, args);
    if (result?.ok === false) throw new Error(result.stderr || `${label} failed`);
    setOperation(`${label} complete`);
    if (result?.stdout || result?.stderr) showOutput([result.stdout, result.stderr].filter(Boolean).join('\n'));
    if (refresh) {
      await window.CortexWorkbench?.renderGit?.();
      window.dispatchEvent(new Event('cortex-git-updated'));
    }
    return result;
  } catch (error) {
    setOperation(`${label} failed`);
    showOutput(`${label}: ${error}`);
    return null;
  }
}

async function showHistory() {
  try {
    const commits = await invoke('git_history', { limit: 100 });
    const text = commits.map((commit) => `${commit.sha.slice(0, 10)}  ${new Date(commit.timestamp * 1000).toLocaleString()}  ${commit.author}\n  ${commit.subject}`).join('\n\n');
    showOutput(text || 'No commits.');
  } catch (error) { showOutput(`Git history: ${error}`); }
}

async function cloneRepository() {
  const url = prompt('Repository URL (HTTPS or SSH)')?.trim();
  if (!url) return;
  const parent = await open({ directory: true, multiple: false, title: 'Choose clone destination' }).catch(() => null);
  if (!parent) return;
  const directory = prompt('Folder name (leave blank to use repository name)', '')?.trim() || null;
  setOperation('Cloning repository…');
  try {
    const path = await invoke('git_clone_repository', { url, parent, directory });
    await window.CortexWorkbench?.setWorkspace?.(path);
    setOperation('Clone complete');
  } catch (error) {
    setOperation('Clone failed');
    showOutput(`Git clone: ${error}`);
  }
}

function setOperation(text) {
  const node = document.getElementById('git-operation-status');
  if (node) node.textContent = text;
  const status = document.getElementById('cortex-status');
  if (status) status.textContent = text;
}

function showOutput(text) {
  const body = document.getElementById('panel-body');
  if (body) { body.classList.remove('pty-panel'); body.textContent = String(text ?? ''); }
  document.querySelectorAll('[data-panel]').forEach((button) => button.classList.toggle('active', button.dataset.panel === 'output'));
}
