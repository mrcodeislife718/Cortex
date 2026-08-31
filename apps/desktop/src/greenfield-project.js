import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

const button = document.createElement('button');
button.id = 'new-project';
button.title = 'New Project';
button.textContent = '＋P';
document.querySelector('.side-actions')?.prepend(button);
button.addEventListener('click', () => void createProject());

window.addEventListener('keydown', (event) => {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.shiftKey && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    void createProject();
  }
});

async function createProject() {
  const parent = await open({ directory: true, multiple: false, title: 'Choose where to create the Cortex project' });
  if (!parent) return;

  const name = globalThis.prompt('Project name')?.trim();
  if (!name) return;
  if (!isSafeName(name)) {
    showStatus('Project name may contain letters, numbers, spaces, ., -, and _ only.');
    return;
  }

  try {
    showStatus(`Creating ${name}…`);
    await invoke('set_workspace', { path: parent });
    await invoke('create_workspace_directory', { relative: name });
    const separator = String(parent).includes('\\') ? '\\' : '/';
    const projectPath = `${String(parent).replace(/[\\/]$/, '')}${separator}${name}`;
    await window.CortexWorkbench?.setWorkspace?.(projectPath);

    if (globalThis.confirm('Initialize this project as a Git repository?')) {
      const result = await invoke('run_workspace_command', { command: 'git', args: ['init'] });
      if (!result?.ok) throw new Error(result?.stderr || 'git init failed');
    }

    if (globalThis.confirm('Create a README.md starter file?')) {
      await invoke('create_workspace_file', { relative: 'README.md' });
      await invoke('write_workspace_file', { relative: 'README.md', text: `# ${name}\n` });
      await window.CortexWorkbench?.openFile?.('README.md');
    }

    window.dispatchEvent(new CustomEvent('cortex-project-created', { detail: { path: projectPath, name } }));
    showStatus(`Project ${name} ready`);
  } catch (error) {
    showStatus(`Project creation failed: ${error}`);
  }
}

function isSafeName(value) {
  return value.length <= 128 && value !== '.' && value !== '..' && /^[A-Za-z0-9._ -]+$/.test(value);
}

function showStatus(text) {
  const status = document.getElementById('cortex-status');
  if (status) status.textContent = text;
}
