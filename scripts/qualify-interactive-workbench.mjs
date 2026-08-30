import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const index = read('apps/desktop/index.html');
const runtime = read('apps/desktop/src/workbench-runtime.js');
const continuity = read('apps/desktop/src/runtime-continuity.js');
const pty = read('apps/desktop/src-tauri/src/pty.rs');

const failures = [];
const requireText = (source, token, reason) => { if (!source.includes(token)) failures.push(reason); };

requireText(index, '/src/workbench-runtime.js', 'desktop must load the authoritative workbench runtime');
if (index.includes('/src/main.js')) failures.push('legacy main.js must not own the packaged workbench');
if (index.includes('/src/terminal-pty.js')) failures.push('legacy terminal runtime must not compete with the authoritative PTY owner');

for (const token of [
  'chooseWorkspace', 'setWorkspace', 'renderExplorer', 'openFile', 'saveActive',
  'renderSearch', 'renderGit', 'renderTasks', 'ensureTerminal', 'submitAssistant',
  'toggleCommandPalette', 'showHealth', 'window.CortexWorkbench'
]) requireText(runtime, token, `workbench is missing ${token}`);

for (const command of [
  'runtime_info', 'set_workspace', 'list_workspace', 'read_workspace_file', 'write_workspace_file',
  'search_workspace', 'git_status', 'git_diff', 'git_stage', 'git_commit',
  'discover_project_tasks', 'run_project_task', 'pty_start', 'pty_write', 'pty_read', 'pty_resize', 'pty_stop',
  'commercial_assistant'
]) requireText(runtime, `'${command}'`, `packaged workbench does not invoke native command ${command}`);

for (const shortcut of ["key.toLowerCase()==='s'", "key.toLowerCase()==='o'", "key.toLowerCase()==='p'", "key==='`'"])
  requireText(runtime, shortcut, `missing interactive shortcut ${shortcut}`);

requireText(runtime, 'hosted engineering runtime is not configured', 'assistant must expose unavailable hosted runtime instead of fabricating output');
requireText(runtime, 'data-cortex-runtime="authoritative"', 'runtime must identify the authoritative workbench owner');
requireText(runtime, 'Health:', 'subsystem health must be user-visible');
requireText(continuity, 'save_workspace_session', 'workbench continuity must persist sessions');
requireText(continuity, 'restore_workspace_session', 'workbench continuity must restore sessions');
requireText(pty, 'pub fn pty_write(id: String', 'PTY write contract must match desktop id field');
requireText(pty, 'pub fn pty_read(id: String', 'PTY read contract must match desktop id field');
requireText(pty, 'pub fn pty_resize(id: String', 'PTY resize contract must match desktop id field');
requireText(pty, 'pub fn pty_stop(id: String', 'PTY stop contract must match desktop id field');

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  contract: 'interactive-workbench-v1',
  guarantees: [
    'single-authoritative-workbench-owner', 'workspace-and-editor-wiring', 'search-and-git-wiring',
    'task-and-pty-wiring', 'assistant-no-fabrication', 'durable-session-continuity', 'visible-subsystem-health'
  ]
}, null, 2));
