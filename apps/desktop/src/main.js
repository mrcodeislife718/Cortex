import * as monaco from 'monaco-editor';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import 'monaco-editor/min/vs/editor/editor.main.css';
import './styles.css';

const root = document.querySelector('#cortex-root');
root.innerHTML = `
<div class="workbench" role="application" aria-label="Cortex IDE">
  <aside class="activity-bar" aria-label="Activity Bar">
    <button class="activity active" data-view="explorer" title="Explorer">▱</button><button class="activity" data-view="search" title="Search">⌕</button><button class="activity" data-view="source-control" title="Source Control">⑂</button><button class="activity" data-view="run" title="Run and Debug">▷</button><button class="activity" data-view="extensions" title="Extensions">◇</button><span class="activity-spacer"></span><button class="activity" data-view="settings" title="Settings">⚙</button>
  </aside>
  <aside class="side-bar" aria-label="Primary Side Bar"><header><strong id="side-title">EXPLORER</strong><button id="open-folder" title="Open Folder">＋</button></header><section id="side-content" class="side-content"><div class="empty-side">Open a folder to begin.</div></section></aside>
  <main class="center"><div class="tabs" id="tabs" role="tablist"></div><div id="editor" class="editor" aria-label="Editor"></div><section class="panel" aria-label="Panel"><nav class="panel-tabs"><button data-panel="problems" class="active">PROBLEMS <span class="badge">0</span></button><button data-panel="output">OUTPUT</button><button data-panel="debug">DEBUG CONSOLE</button><button data-panel="terminal">TERMINAL</button><span class="panel-grow"></span><button id="clear-panel" title="Clear Panel">⌫</button></nav><div class="panel-body" id="panel-body"><span class="muted">No problems detected.</span></div></section></main>
  <aside class="assistant" aria-label="Cortex Assistant"><header><strong>CORTEX</strong><span class="status-dot" title="Ready"></span></header><div class="assistant-body"><div class="assistant-empty"><div class="cortex-mark">C</div><h2>What are we building?</h2><p>Ask naturally. Cortex chooses context and engineering depth automatically.</p><div class="suggestions"><button>Explain this repository</button><button>Fix this failure</button><button>What breaks if I change this?</button><button>Ship this safely</button></div></div></div><form class="composer" id="assistant-form"><textarea id="assistant-input" rows="3" placeholder="Ask Cortex anything…" aria-label="Ask Cortex"></textarea><div class="composer-footer"><span id="context-label">Open a workspace</span><button type="submit" title="Send">↑</button></div></form></aside>
  <footer class="status-bar"><span id="git-branch">⑂ —</span><span>✓ 0</span><span>⚠ 0</span><span class="status-grow"></span><span id="cursor-position">Ln 1, Col 1</span><span>UTF-8</span><span id="language">Plain Text</span><span id="cortex-status">Cortex Ready</span></footer>
</div>`;

const models = new Map();
let activePath = null;
let workspaceRoot = null;
let activeView = 'explorer';
let panelMode = 'problems';
const editor = monaco.editor.create(document.getElementById('editor'), { value: '', language: 'plaintext', automaticLayout: true, minimap: { enabled: true }, fontSize: 14, lineHeight: 22, padding: { top: 12 }, smoothScrolling: true, cursorSmoothCaretAnimation: 'on', renderWhitespace: 'selection', bracketPairColorization: { enabled: true }, stickyScroll: { enabled: true } });

async function chooseWorkspace() {
  const selected = await open({ directory: true, multiple: false, title: 'Open Cortex Workspace' });
  if (!selected) return;
  workspaceRoot = await invoke('set_workspace', { path: selected });
  document.getElementById('context-label').textContent = 'Workspace context automatic';
  document.getElementById('cortex-status').textContent = 'Indexing workspace…';
  await renderExplorer();
  await refreshGit();
  document.getElementById('cortex-status').textContent = 'Cortex Ready';
}

async function renderExplorer(relative = '') {
  activeView = 'explorer';
  setSideTitle('EXPLORER');
  const entries = await invoke('list_workspace', { relative: relative || null });
  const side = document.getElementById('side-content');
  side.replaceChildren();
  const rootRow = document.createElement('button');
  rootRow.className = 'workspace-row expanded'; rootRow.textContent = `⌄ ${workspaceRoot?.split(/[\\/]/).at(-1)?.toUpperCase() ?? 'WORKSPACE'}`; rootRow.onclick = () => renderExplorer(''); side.append(rootRow);
  if (relative) { const up = document.createElement('button'); up.className = 'file-row'; up.textContent = '↰  ..'; up.onclick = () => renderExplorer(relative.split('/').slice(0,-1).join('/')); side.append(up); }
  for (const entry of entries) {
    const row = document.createElement('button'); row.className = 'file-row'; row.textContent = `${entry.is_directory ? '▸' : fileGlyph(entry.name)}  ${entry.name}`;
    row.onclick = () => entry.is_directory ? renderExplorer(entry.relative_path) : openFile(entry.relative_path);
    side.append(row);
  }
}

async function openFile(relativePath, { line = null } = {}) {
  let model = models.get(relativePath);
  if (!model) {
    const text = await invoke('read_workspace_file', { relative: relativePath });
    model = monaco.editor.createModel(text, languageFor(relativePath), monaco.Uri.parse(`cortex://workspace/${relativePath}`));
    models.set(relativePath, model);
  }
  activePath = relativePath; editor.setModel(model); renderTabs(); document.getElementById('language').textContent = languageLabel(relativePath);
  if (line) { editor.revealLineInCenter(line); editor.setPosition({ lineNumber: line, column: 1 }); }
}

function renderTabs() {
  const tabs = document.getElementById('tabs'); tabs.replaceChildren();
  for (const [path, model] of models) {
    const tab = document.createElement('button'); tab.className = `tab ${path === activePath ? 'active' : ''}`; tab.setAttribute('role','tab'); tab.textContent = `${path.split('/').at(-1)}${model.getAlternativeVersionId() > 1 ? ' •' : ''}`; tab.onclick = () => { activePath = path; editor.setModel(model); renderTabs(); }; tabs.append(tab);
  }
}

async function saveActive() {
  if (!activePath) return;
  await invoke('write_workspace_file', { relative: activePath, text: editor.getValue() });
  document.getElementById('cortex-status').textContent = `Saved ${activePath}`;
  renderTabs();
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
  const side = document.getElementById('side-content'); side.textContent = '';
  for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) { const row=document.createElement('div'); row.className='scm-row'; row.textContent=line; side.append(row); }
  if (!result.ok && result.stderr) side.textContent = result.stderr;
}

async function refreshGit() {
  try { const result = await invoke('git_status'); const branch = result.stdout.split(/\r?\n/)[0]?.replace(/^##\s*/, '').split('...')[0] || '—'; document.getElementById('git-branch').textContent = `⑂ ${branch}`; } catch { document.getElementById('git-branch').textContent = '⑂ —'; }
}

async function runTerminalInput(input) {
  const [command, ...args] = splitCommand(input);
  if (!command) return;
  const body = document.getElementById('panel-body'); panelMode='terminal'; body.textContent = `$ ${input}\n`;
  try { const result = await invoke('run_workspace_command', { command, args }); body.textContent += result.stdout + result.stderr + `\n[exit ${result.code ?? 'signal'}]`; } catch (error) { body.textContent += `Cortex denied/stopped command: ${error}`; }
}

function renderTerminalPrompt() {
  panelMode='terminal'; const body=document.getElementById('panel-body'); body.innerHTML='<form id="terminal-form" class="terminal-form"><span>$</span><input id="terminal-input" autocomplete="off" spellcheck="false"/></form><pre id="terminal-output"></pre>';
  document.getElementById('terminal-form').onsubmit=async(e)=>{e.preventDefault();const value=document.getElementById('terminal-input').value; await runTerminalInput(value);}; document.getElementById('terminal-input').focus();
}

for (const button of document.querySelectorAll('.activity')) button.addEventListener('click', async () => { document.querySelectorAll('.activity').forEach((item)=>item.classList.remove('active')); button.classList.add('active'); activeView=button.dataset.view ?? 'settings'; if (!workspaceRoot && ['explorer','search','source-control','run'].includes(activeView)) return; if (activeView==='explorer') await renderExplorer(); else if(activeView==='search') await renderSearch(); else if(activeView==='source-control') await renderSourceControl(); else setSideTitle(activeView.replace('-',' ').toUpperCase()); });
for (const button of document.querySelectorAll('[data-panel]')) button.addEventListener('click',()=>{document.querySelectorAll('[data-panel]').forEach(x=>x.classList.remove('active'));button.classList.add('active');panelMode=button.dataset.panel;if(panelMode==='terminal')renderTerminalPrompt();});
document.getElementById('open-folder').onclick=chooseWorkspace;
document.getElementById('clear-panel').onclick=()=>{document.getElementById('panel-body').textContent='';};
document.getElementById('assistant-form').addEventListener('submit',(event)=>{event.preventDefault();const input=document.getElementById('assistant-input');const value=input.value.trim();if(!value)return;const body=document.querySelector('.assistant-body');const item=document.createElement('div');item.className='assistant-message';item.textContent=value;body.replaceChildren(item);input.value='';document.getElementById('context-label').textContent='Engineering runtime connection required';});
for(const suggestion of document.querySelectorAll('.suggestions button')) suggestion.onclick=()=>{document.getElementById('assistant-input').value=suggestion.textContent;document.getElementById('assistant-input').focus();};
editor.onDidChangeCursorPosition(({position})=>{document.getElementById('cursor-position').textContent=`Ln ${position.lineNumber}, Col ${position.column}`;});
editor.onDidChangeModelContent(()=>renderTabs());
window.addEventListener('keydown',async(event)=>{const mod=event.ctrlKey||event.metaKey;if(mod&&event.key.toLowerCase()==='s'){event.preventDefault();await saveActive();}if(mod&&event.key.toLowerCase()==='o'){event.preventDefault();await chooseWorkspace();}if(mod&&event.shiftKey&&event.key.toLowerCase()==='f'){event.preventDefault();await renderSearch();}});

function setSideTitle(value){document.getElementById('side-title').textContent=value;}
function fileGlyph(name){if(/\.m?[jt]sx?$/.test(name))return'JS';if(name.endsWith('.md'))return'#';if(name.endsWith('.json'))return'{}';return'·';}
function languageFor(name){if(/\.tsx?$/.test(name))return'typescript';if(/\.jsx?$|\.mjs$|\.cjs$/.test(name))return'javascript';if(name.endsWith('.json'))return'json';if(name.endsWith('.md'))return'markdown';if(name.endsWith('.css'))return'css';if(name.endsWith('.html'))return'html';return'plaintext';}
function languageLabel(name){const value=languageFor(name);return value==='plaintext'?'Plain Text':value[0].toUpperCase()+value.slice(1);}
function splitCommand(input){const out=[];let current='',quote=null,escape=false;for(const ch of input.trim()){if(escape){current+=ch;escape=false;continue;}if(ch==='\\'){escape=true;continue;}if(quote){if(ch===quote)quote=null;else current+=ch;continue;}if(ch==='"'||ch==="'"){quote=ch;continue;}if(/\s/.test(ch)){if(current){out.push(current);current='';}}else current+=ch;}if(quote)throw new Error('unclosed quote');if(current)out.push(current);return out;}
