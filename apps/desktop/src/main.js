import * as monaco from 'monaco-editor';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import './styles.css';

const root = document.querySelector('#cortex-root');
root.innerHTML = `
<div class="workbench" role="application" aria-label="Cortex IDE">
  <aside class="activity-bar" aria-label="Activity Bar">
    <div class="brand-mark" title="Cortex">C</div><button class="activity active" data-view="explorer" title="Explorer">▱</button><button class="activity" data-view="search" title="Search">⌕</button><button class="activity" data-view="source-control" title="Source Control">⑂</button><button class="activity" data-view="run" title="Run and Debug">▷</button><button class="activity" data-view="extensions" title="Extensions">◇</button><span class="activity-spacer"></span><button class="activity" data-view="settings" title="Settings">⚙</button>
  </aside>
  <aside class="side-bar" aria-label="Primary Side Bar"><header><strong id="side-title">EXPLORER</strong><span class="side-actions"><button id="new-file" title="New File">＋F</button><button id="new-folder" title="New Folder">＋D</button><button id="open-folder" title="Open Folder">▱</button></span></header><section id="side-content" class="side-content"><div class="empty-side"><strong>CORTEX</strong><span>Open a folder to begin.</span></div></section></aside>
  <main class="center"><div class="tabs" id="tabs" role="tablist"></div><div id="editor-host" class="editor-host"><div id="editor" class="editor" aria-label="Editor"></div></div><section class="panel" aria-label="Panel"><nav class="panel-tabs"><button data-panel="problems" class="active">PROBLEMS <span class="badge">0</span></button><button data-panel="output">OUTPUT</button><button data-panel="debug">DEBUG CONSOLE</button><button data-panel="terminal">TERMINAL</button><span class="panel-grow"></span><button id="split-editor" title="Split Editor">◫</button><button id="clear-panel" title="Clear Panel">⌫</button></nav><div class="panel-body" id="panel-body"><span class="muted">No problems detected.</span></div></section></main>
  <aside class="assistant" aria-label="Cortex Assistant"><header><strong>CORTEX</strong><span class="assistant-label">ENGINEERING INTELLIGENCE</span><span class="status-dot" title="Ready"></span></header><div class="assistant-body"><div class="assistant-empty"><div class="cortex-mark">C</div><h2>What are we building?</h2><p>Ask naturally. Cortex chooses context and engineering depth automatically.</p><div class="suggestions"><button>Explain this repository</button><button>Fix this failure</button><button>What breaks if I change this?</button><button>Ship this safely</button></div></div></div><form class="composer" id="assistant-form"><textarea id="assistant-input" rows="3" placeholder="Ask Cortex anything…" aria-label="Ask Cortex"></textarea><div class="composer-footer"><span id="context-label">Open a workspace</span><button type="submit" title="Send">↑</button></div></form></aside>
  <footer class="status-bar"><span id="git-branch">⑂ —</span><span id="error-count">✓ 0</span><span id="warning-count">⚠ 0</span><span class="status-grow"></span><span id="cursor-position">Ln 1, Col 1</span><span>UTF-8</span><span id="language">Plain Text</span><span id="cortex-status">Cortex Ready</span></footer>
</div>`;

const models = new Map();
const pathsByModel = new Map();
const savedVersions = new Map();
let activePath = null;
let workspaceRoot = null;
let currentExplorerRelative = '';
let panelMode = 'problems';
let secondaryEditor = null;
let currentEditor;
let recoveryTimer = null;

const editorOptions = { value: '', language: 'plaintext', theme: 'vs-dark', automaticLayout: true, minimap: { enabled: true }, fontSize: 14, lineHeight: 22, padding: { top: 12 }, smoothScrolling: true, cursorSmoothCaretAnimation: 'on', renderWhitespace: 'selection', bracketPairColorization: { enabled: true }, stickyScroll: { enabled: true } };
const primaryEditor = monaco.editor.create(document.getElementById('editor'), editorOptions);
currentEditor = primaryEditor;
bindEditor(primaryEditor);

async function chooseWorkspace() {
  if ([...models.keys()].some(isDirty) && !confirm('Open another workspace and discard unsaved editor buffers?')) return;
  const selected = await open({ directory: true, multiple: false, title: 'Open Cortex Workspace' });
  if (!selected) return;
  await loadWorkspace(selected, { clearEditors: true });
}

async function loadWorkspace(selected, { clearEditors = false } = {}) {
  if (clearEditors) disposeAllEditors();
  workspaceRoot = await invoke('set_workspace', { path: selected });
  currentExplorerRelative = '';
  document.getElementById('context-label').textContent = 'Workspace context automatic';
  setStatus('Indexing workspace…');
  await renderExplorer();
  await refreshGit();
  window.dispatchEvent(new CustomEvent('cortex-workspace-changed', { detail: { name: workspaceRoot.split(/[\\/]/).at(-1), path: workspaceRoot } }));
  setStatus('Cortex Ready');
  scheduleRecovery();
}

async function renderExplorer(relative = currentExplorerRelative) {
  currentExplorerRelative = relative || '';
  setSideTitle('EXPLORER');
  const entries = await invoke('list_workspace', { relative: currentExplorerRelative || null });
  const side = document.getElementById('side-content');
  side.replaceChildren();
  const rootRow = document.createElement('button');
  rootRow.className = 'workspace-row expanded'; rootRow.textContent = `⌄ ${workspaceRoot?.split(/[\\/]/).at(-1)?.toUpperCase() ?? 'WORKSPACE'}`; rootRow.onclick = () => renderExplorer(''); side.append(rootRow);
  if (currentExplorerRelative) { const up = document.createElement('button'); up.className = 'file-row'; up.textContent = '↰  ..'; up.onclick = () => renderExplorer(currentExplorerRelative.split('/').slice(0,-1).join('/')); side.append(up); }
  for (const entry of entries) {
    const row = document.createElement('button'); row.className = 'file-row'; row.dataset.path = entry.relative_path; row.textContent = `${entry.is_directory ? '▸' : fileGlyph(entry.name)}  ${entry.name}`;
    row.onclick = () => entry.is_directory ? renderExplorer(entry.relative_path) : openFile(entry.relative_path);
    row.oncontextmenu = (event) => { event.preventDefault(); void manageEntry(entry); };
    side.append(row);
  }
}

async function createEntry(kind) {
  if (!workspaceRoot) return chooseWorkspace();
  const name = prompt(`${kind === 'file' ? 'New file' : 'New folder'} name`);
  if (!name?.trim()) return;
  const relative = [currentExplorerRelative, name.trim()].filter(Boolean).join('/');
  try {
    await invoke(kind === 'file' ? 'create_workspace_file' : 'create_workspace_directory', { relative });
    await renderExplorer();
    if (kind === 'file') await openFile(relative);
  } catch (error) { showPanel('output', `Cortex could not create ${relative}: ${error}`); }
}

async function manageEntry(entry) {
  const action = prompt(`Manage ${entry.relative_path}\nType: rename or delete`, 'rename')?.trim().toLowerCase();
  if (action === 'rename') {
    const nextName = prompt('New name', entry.name)?.trim();
    if (!nextName || nextName === entry.name) return;
    const parent = entry.relative_path.split('/').slice(0, -1).join('/');
    const destination = [parent, nextName].filter(Boolean).join('/');
    try {
      await invoke('rename_workspace_entry', { relative: entry.relative_path, destination });
      if (models.has(entry.relative_path)) await remapOpenModel(entry.relative_path, destination);
      await renderExplorer(); scheduleRecovery();
    } catch (error) { showPanel('output', `Rename failed: ${error}`); }
  } else if (action === 'delete') {
    if (!confirm(`Permanently delete ${entry.relative_path}?`)) return;
    try {
      await invoke('delete_workspace_entry', { relative: entry.relative_path });
      if (models.has(entry.relative_path)) closeFile(entry.relative_path, { force: true });
      await renderExplorer(); scheduleRecovery();
    } catch (error) { showPanel('output', `Delete failed: ${error}`); }
  }
}

async function remapOpenModel(oldPath, newPath) {
  const old = models.get(oldPath); if (!old) return;
  const text = old.getValue(); const dirty = isDirty(oldPath);
  closeFile(oldPath, { force: true });
  const model = monaco.editor.createModel(text, languageFor(newPath), monaco.Uri.parse(`cortex://workspace/${newPath}`));
  models.set(newPath, model); pathsByModel.set(model, newPath); savedVersions.set(newPath, dirty ? -1 : model.getAlternativeVersionId());
  activatePath(newPath);
}

async function openFile(relativePath, { line = null, editor = currentEditor } = {}) {
  let model = models.get(relativePath);
  if (!model) {
    const text = await invoke('read_workspace_file', { relative: relativePath });
    model = monaco.editor.createModel(text, languageFor(relativePath), monaco.Uri.parse(`cortex://workspace/${relativePath}`));
    models.set(relativePath, model); pathsByModel.set(model, relativePath); savedVersions.set(relativePath, model.getAlternativeVersionId());
  }
  activePath = relativePath; editor.setModel(model); currentEditor = editor; renderTabs(); updateLanguage(relativePath);
  if (line) { editor.revealLineInCenter(line); editor.setPosition({ lineNumber: line, column: 1 }); }
  scheduleRecovery();
}

function activatePath(path, editor = currentEditor) {
  const model = models.get(path); if (!model) return;
  activePath = path; currentEditor = editor; editor.setModel(model); editor.focus(); renderTabs(); updateLanguage(path); scheduleRecovery();
}

function renderTabs() {
  const tabs = document.getElementById('tabs'); tabs.replaceChildren();
  for (const [path] of models) {
    const tab = document.createElement('div'); tab.className = `tab ${path === activePath ? 'active' : ''}`; tab.setAttribute('role','tab');
    const openButton = document.createElement('button'); openButton.className = 'tab-open'; openButton.textContent = `${path.split('/').at(-1)}${isDirty(path) ? ' •' : ''}`; openButton.title = path; openButton.onclick = () => activatePath(path);
    const closeButton = document.createElement('button'); closeButton.className = 'tab-close'; closeButton.textContent = '×'; closeButton.title = `Close ${path}`; closeButton.onclick = (event) => { event.stopPropagation(); closeFile(path); };
    tab.append(openButton, closeButton); tabs.append(tab);
  }
}

function closeFile(path, { force = false } = {}) {
  const model = models.get(path); if (!model) return true;
  if (!force && isDirty(path) && !confirm(`Discard unsaved changes in ${path}?`)) return false;
  if (primaryEditor.getModel() === model) primaryEditor.setModel(null);
  if (secondaryEditor?.getModel() === model) secondaryEditor.setModel(null);
  models.delete(path); pathsByModel.delete(model); savedVersions.delete(path); model.dispose();
  if (activePath === path) {
    const next = [...models.keys()].at(-1) ?? null; activePath = next;
    if (next) activatePath(next); else updateLanguage(null);
  }
  renderTabs(); scheduleRecovery(); return true;
}

async function saveActive() {
  const model = currentEditor.getModel(); const path = model ? pathsByModel.get(model) : null;
  if (!path) return;
  await invoke('write_workspace_file', { relative: path, text: model.getValue() });
  savedVersions.set(path, model.getAlternativeVersionId()); activePath = path; setStatus(`Saved ${path}`); renderTabs(); scheduleRecovery();
}

async function renderSearch() {
  setSideTitle('SEARCH');
  const side = document.getElementById('side-content'); side.innerHTML = `<form id="search-form" class="search-form"><input id="search-input" placeholder="Search workspace" autocomplete="off"/><button>⌕</button></form><div id="search-results"></div>`;
  document.getElementById('search-form').onsubmit = async (event) => { event.preventDefault(); const query = document.getElementById('search-input').value.trim(); if (!query) return; const matches = await invoke('search_workspace', { query }); const results = document.getElementById('search-results'); results.replaceChildren(); for (const match of matches) { const row = document.createElement('button'); row.className='search-result'; row.textContent=`${match.relative_path}:${match.line}  ${match.preview}`; row.onclick=()=>openFile(match.relative_path,{line:match.line}); results.append(row); } };
  document.getElementById('search-input').focus();
}

async function renderSourceControl() {
  setSideTitle('SOURCE CONTROL');
  const result = await invoke('git_status');
  const side = document.getElementById('side-content'); side.replaceChildren();
  if (!result.ok) { side.textContent = result.stderr || 'Git status unavailable.'; return; }
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  const changes = lines.filter((line) => !line.startsWith('##')).map(parseGitLine);
  const form = document.createElement('form'); form.className = 'scm-commit'; form.innerHTML = `<textarea id="commit-message" rows="2" placeholder="Message (Ctrl+Enter to commit)"></textarea><div><button type="button" id="stage-all">Stage All</button><button type="submit">Commit</button></div>`;
  form.onsubmit = async (event) => { event.preventDefault(); const message=document.getElementById('commit-message').value.trim(); if(!message)return; const commit=await invoke('git_commit',{message}); showPanel('output', commit.stdout || commit.stderr || 'Commit complete.'); await renderSourceControl(); await refreshGit(); };
  form.querySelector('#commit-message').onkeydown=(event)=>{if(event.ctrlKey&&event.key==='Enter'){event.preventDefault();form.requestSubmit();}};
  form.querySelector('#stage-all').onclick=async()=>{if(!changes.length)return;await invoke('git_stage',{paths:changes.map(change=>change.path)});await renderSourceControl();}; side.append(form);
  if (!changes.length) { const clean=document.createElement('div'); clean.className='empty-side'; clean.textContent='No changes.'; side.append(clean); return; }
  for (const change of changes) {
    const row=document.createElement('div'); row.className='scm-change';
    const openButton=document.createElement('button'); openButton.className='scm-file'; openButton.textContent=`${change.status}  ${change.path}`; openButton.onclick=()=>openFile(change.path).catch(()=>{});
    const diff=document.createElement('button'); diff.textContent='Δ'; diff.title='Show diff'; diff.onclick=async()=>{const result=await invoke('git_diff',{relative:change.path});showPanel('output',result.stdout||result.stderr||'No diff.');};
    const toggle=document.createElement('button'); toggle.textContent=change.staged?'−':'＋'; toggle.title=change.staged?'Unstage':'Stage'; toggle.onclick=async()=>{await invoke(change.staged?'git_unstage':'git_stage',{paths:[change.path]});await renderSourceControl();};
    row.append(openButton,diff,toggle); side.append(row);
  }
}

async function renderRunAndDebug() {
  setSideTitle('RUN AND DEBUG');
  const side=document.getElementById('side-content'); side.replaceChildren();
  const tasks=await invoke('discover_project_tasks');
  if(!tasks.length){const empty=document.createElement('div');empty.className='empty-side';empty.innerHTML='<strong>No package tasks detected.</strong><span>Cortex uses project conventions automatically when they exist.</span>';side.append(empty);return;}
  for(const task of tasks){const row=document.createElement('button');row.className=`task-row task-${task.kind}`;row.innerHTML=`<span class="task-kind">${task.kind.toUpperCase()}</span><strong>${escapeHtml(task.name)}</strong><small>${escapeHtml(task.packageManager)} · ${escapeHtml(task.command)}</small>`;row.onclick=()=>runTask(task);side.append(row);}
}

async function runTask(task) {
  showPanel(task.kind==='test'?'problems':'output',`Running ${task.packageManager} task: ${task.name}…`);
  setStatus(`Running ${task.name}…`);
  try {
    const result=await invoke('run_project_task',{name:task.name});
    const output=`$ ${task.packageManager} run ${task.name}\n${result.stdout}${result.stderr}\n[exit ${result.code ?? 'signal'}]`;
    showPanel(task.kind==='test'?'problems':'output',output);
    if(task.kind==='test') updateTestStatus(result.ok);
    setStatus(result.ok?`${task.name} passed`:`${task.name} failed`);
  } catch(error){showPanel('output',`Task failed: ${error}`);setStatus(`${task.name} failed`);}
}

function updateTestStatus(ok){document.getElementById('error-count').textContent=ok?'✓ 1':'✓ 0';document.querySelector('[data-panel="problems"] .badge').textContent=ok?'0':'1';}

async function refreshGit() {
  try { const result = await invoke('git_status'); const branch = result.stdout.split(/\r?\n/)[0]?.replace(/^##\s*/, '').split('...')[0] || '—'; document.getElementById('git-branch').textContent = `⑂ ${branch}`; } catch { document.getElementById('git-branch').textContent = '⑂ —'; }
}

function renderTerminalPrompt() {
  panelMode='terminal'; const body=document.getElementById('panel-body');
  if(body.querySelector('#terminal-form')){body.querySelector('#terminal-input')?.focus();return;}
  body.innerHTML='<pre id="terminal-output" class="terminal-output"></pre><form id="terminal-form" class="terminal-form"><span>$</span><input id="terminal-input" autocomplete="off" spellcheck="false"/></form>';
  const form=document.getElementById('terminal-form'); const input=document.getElementById('terminal-input');
  form.onsubmit=async(event)=>{event.preventDefault();const value=input.value.trim();if(!value)return;input.value='';await runTerminalInput(value);input.focus();}; input.focus();
}

async function runTerminalInput(input) {
  const [command, ...args] = splitCommand(input); if (!command) return;
  const output=document.getElementById('terminal-output'); if(!output)return;
  output.textContent += `${output.textContent?'\n':''}$ ${input}\n`; setStatus(`Running ${command}…`);
  try { const result=await invoke('run_workspace_command',{command,args});output.textContent+=`${result.stdout}${result.stderr}[exit ${result.code ?? 'signal'}]\n`;setStatus('Cortex Ready'); }
  catch(error){output.textContent+=`Cortex denied/stopped command: ${error}\n`;setStatus('Command stopped');}
  output.scrollTop=output.scrollHeight;
}

function showPanel(mode, text) {
  panelMode=mode; document.querySelectorAll('[data-panel]').forEach(button=>button.classList.toggle('active',button.dataset.panel===mode));
  const body=document.getElementById('panel-body'); body.textContent=text;
}

function splitEditor() {
  const host=document.getElementById('editor-host');
  if(secondaryEditor){secondaryEditor.dispose();secondaryEditor=null;host.querySelector('.editor-secondary')?.remove();host.classList.remove('split');currentEditor=primaryEditor;return;}
  const target=document.createElement('div');target.className='editor editor-secondary';host.append(target);host.classList.add('split');
  secondaryEditor=monaco.editor.create(target,{...editorOptions,value:undefined});secondaryEditor.setModel(primaryEditor.getModel());bindEditor(secondaryEditor);secondaryEditor.focus();currentEditor=secondaryEditor;scheduleRecovery();
}

function bindEditor(instance) {
  instance.onDidFocusEditorWidget(()=>{currentEditor=instance;const path=pathsByModel.get(instance.getModel());if(path){activePath=path;renderTabs();updateLanguage(path);}});
  instance.onDidChangeCursorPosition(({position})=>{if(instance===currentEditor)document.getElementById('cursor-position').textContent=`Ln ${position.lineNumber}, Col ${position.column}`;});
  instance.onDidChangeModelContent(()=>{const path=pathsByModel.get(instance.getModel());if(path){activePath=path;renderTabs();scheduleRecovery();}});
}

function isDirty(path){const model=models.get(path);return Boolean(model)&&model.getAlternativeVersionId()!==savedVersions.get(path);}
function updateLanguage(path){document.getElementById('language').textContent=path?languageLabel(path):'Plain Text';}
function setStatus(text){document.getElementById('cortex-status').textContent=text;}

function disposeAllEditors(){if(secondaryEditor){secondaryEditor.dispose();secondaryEditor=null;document.querySelector('.editor-secondary')?.remove();document.getElementById('editor-host').classList.remove('split');}primaryEditor.setModel(null);for(const model of models.values())model.dispose();models.clear();pathsByModel.clear();savedVersions.clear();activePath=null;}

function scheduleRecovery(){clearTimeout(recoveryTimer);recoveryTimer=setTimeout(()=>void checkpointRecovery(),250);}
async function checkpointRecovery(){
  if(!workspaceRoot)return;
  const unsavedBuffers=[...models.entries()].filter(([path])=>isDirty(path)).map(([path,model])=>({path,text:model.getValue(),version:model.getVersionId()}));
  const session={workspace:workspaceRoot,openEditors:[...models.keys()],activePath,unsavedBuffers,split:Boolean(secondaryEditor)};
  try{await invoke('save_workspace_session',{session});}catch{/* recovery failure must never interrupt editing */}
}
async function restoreRecovery(){
  try{
    const session=await invoke('restore_workspace_session');if(!session?.workspace)return;
    await loadWorkspace(session.workspace,{clearEditors:true});
    const unsaved=new Map((session.unsavedBuffers??[]).map(buffer=>[buffer.path,buffer]));
    for(const path of session.openEditors??[]){try{await openFile(path);const buffer=unsaved.get(path);if(buffer){models.get(path)?.setValue(buffer.text);}}catch{/* removed file */}}
    if(session.activePath&&models.has(session.activePath))activatePath(session.activePath);
    if(session.split&&!secondaryEditor)splitEditor();
    setStatus(unsaved.size?'Recovered unsaved work':'Cortex Ready');
  }catch{try{await invoke('clear_workspace_session');}catch{/* no-op */}}
}

function parseGitLine(line){const status=line.slice(0,2);let path=line.slice(3).trim();if(path.includes(' -> '))path=path.split(' -> ').at(-1);return{status,path,staged:status[0]!==' '&&status[0]!=='?'};}
function setSideTitle(value){document.getElementById('side-title').textContent=value;}
function fileGlyph(name){if(/\.m?[jt]sx?$/.test(name))return'JS';if(/\.tsx?$/.test(name))return'TS';if(name.endsWith('.py'))return'PY';if(name.endsWith('.rs'))return'RS';if(name.endsWith('.go'))return'GO';if(name.endsWith('.md'))return'#';if(name.endsWith('.json'))return'{}';return'·';}
function languageFor(name){if(/\.tsx?$/.test(name))return'typescript';if(/\.jsx?$|\.mjs$|\.cjs$/.test(name))return'javascript';if(name.endsWith('.json'))return'json';if(name.endsWith('.md'))return'markdown';if(name.endsWith('.css'))return'css';if(name.endsWith('.html'))return'html';if(name.endsWith('.py'))return'python';if(name.endsWith('.rs'))return'rust';if(name.endsWith('.go'))return'go';if(name.endsWith('.java'))return'java';if(name.endsWith('.cs'))return'csharp';if(/\.(c|h)$/.test(name))return'c';if(/\.(cc|cpp|cxx|hpp)$/.test(name))return'cpp';if(/\.ya?ml$/.test(name))return'yaml';if(/\.(sh|bash)$/.test(name))return'shell';return'plaintext';}
function languageLabel(name){const value=languageFor(name);return value==='plaintext'?'Plain Text':value[0].toUpperCase()+value.slice(1);}
function splitCommand(input){const out=[];let current='',quote=null,escape=false;for(const ch of input.trim()){if(escape){current+=ch;escape=false;continue;}if(ch==='\\'){escape=true;continue;}if(quote){if(ch===quote)quote=null;else current+=ch;continue;}if(ch==='"'||ch==="'"){quote=ch;continue;}if(/\s/.test(ch)){if(current){out.push(current);current='';}}else current+=ch;}if(quote)throw new Error('unclosed quote');if(current)out.push(current);return out;}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}

for (const button of document.querySelectorAll('.activity')) button.addEventListener('click', async () => {
  document.querySelectorAll('.activity').forEach((item)=>item.classList.remove('active')); button.classList.add('active'); const view=button.dataset.view??'settings';
  if (!workspaceRoot && ['explorer','search','source-control','run'].includes(view)) return;
  if(view==='explorer')await renderExplorer();else if(view==='search')await renderSearch();else if(view==='source-control')await renderSourceControl();else if(view==='run')await renderRunAndDebug();else setSideTitle(view.replace('-',' ').toUpperCase());
});
for (const button of document.querySelectorAll('[data-panel]')) button.addEventListener('click',()=>{document.querySelectorAll('[data-panel]').forEach(x=>x.classList.remove('active'));button.classList.add('active');panelMode=button.dataset.panel;if(panelMode==='terminal')renderTerminalPrompt();else if(panelMode==='problems')showPanel('problems','No current diagnostics. Run the project test task or use Cortex diagnostics to populate this panel.');});
document.getElementById('open-folder').onclick=chooseWorkspace;
document.getElementById('new-file').onclick=()=>createEntry('file');
document.getElementById('new-folder').onclick=()=>createEntry('folder');
document.getElementById('split-editor').onclick=splitEditor;
document.getElementById('clear-panel').onclick=()=>{document.getElementById('panel-body').textContent='';};
document.getElementById('assistant-form').addEventListener('submit',(event)=>{event.preventDefault();const input=document.getElementById('assistant-input');const value=input.value.trim();if(!value)return;const body=document.querySelector('.assistant-body');const item=document.createElement('div');item.className='assistant-message';item.textContent=value;body.replaceChildren(item);input.value='';document.getElementById('context-label').textContent='Cortex engineering intent captured';});
for(const suggestion of document.querySelectorAll('.suggestions button')) suggestion.onclick=()=>{document.getElementById('assistant-input').value=suggestion.textContent;document.getElementById('assistant-input').focus();};
window.addEventListener('keydown',async(event)=>{const mod=event.ctrlKey||event.metaKey;if(mod&&event.key.toLowerCase()==='s'){event.preventDefault();await saveActive();}if(mod&&event.key.toLowerCase()==='o'){event.preventDefault();await chooseWorkspace();}if(mod&&event.shiftKey&&event.key.toLowerCase()==='f'){event.preventDefault();await renderSearch();}if(mod&&event.key==='\\'){event.preventDefault();splitEditor();}if(mod&&event.key.toLowerCase()==='w'){event.preventDefault();if(activePath)closeFile(activePath);}});
window.cortexWorkbench={chooseWorkspace,openFile,saveActive,renderExplorer,renderSourceControl,renderRunAndDebug,splitEditor,getWorkspace:()=>workspaceRoot,getActivePath:()=>activePath,setMinimap:(enabled)=>{primaryEditor.updateOptions({minimap:{enabled}});secondaryEditor?.updateOptions({minimap:{enabled}});}};

void restoreRecovery();
