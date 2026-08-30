import * as monaco from 'monaco-editor';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'monaco-editor/min/vs/editor/editor.main.css';
import '@xterm/xterm/css/xterm.css';
import './styles.css';

const root = document.querySelector('#cortex-root');
if (!root) throw new Error('Cortex root is unavailable');

const state = {
  workspace: null,
  explorerPath: '',
  models: new Map(),
  savedVersions: new Map(),
  activePath: null,
  activeView: 'explorer',
  panel: 'problems',
  terminal: null,
  terminalId: null,
  terminalPump: null,
  commandPaletteOpen: false,
  settings: JSON.parse(localStorage.getItem('cortex.settings') || '{}'),
  health: new Map(),
};

root.innerHTML = `
<div class="workbench" role="application" aria-label="Cortex IDE" data-cortex-runtime="authoritative">
  <aside class="activity-bar" aria-label="Activity Bar">
    <div class="brand-mark" title="Cortex">C</div>
    <button class="activity active" data-view="explorer" title="Explorer">▱</button>
    <button class="activity" data-view="search" title="Search">⌕</button>
    <button class="activity" data-view="source-control" title="Source Control">⑂</button>
    <button class="activity" data-view="run" title="Run and Debug">▷</button>
    <button class="activity" data-view="extensions" title="Extensions">◇</button>
    <span class="activity-spacer"></span>
    <button class="activity" data-view="settings" title="Settings">⚙</button>
  </aside>
  <aside class="side-bar" aria-label="Primary Side Bar">
    <header><strong id="side-title">EXPLORER</strong><span class="side-actions"><button id="new-file" title="New File">＋F</button><button id="new-folder" title="New Folder">＋D</button><button id="open-folder" title="Open Folder">▱</button></span></header>
    <section id="side-content" class="side-content"></section>
  </aside>
  <main class="center">
    <div class="tabs" id="tabs" role="tablist"></div>
    <div id="editor-host" class="editor-host"><div id="editor" class="editor" aria-label="Editor"></div></div>
    <section class="panel" aria-label="Panel">
      <nav class="panel-tabs"><button data-panel="problems" class="active">PROBLEMS <span class="badge" id="problem-badge">0</span></button><button data-panel="output">OUTPUT</button><button data-panel="debug">DEBUG CONSOLE</button><button data-panel="terminal">TERMINAL</button><span class="panel-grow"></span><button id="clear-panel" title="Clear Panel">⌫</button></nav>
      <div class="panel-body" id="panel-body"></div>
    </section>
  </main>
  <aside class="assistant" aria-label="Cortex Assistant">
    <header><strong>CORTEX</strong><span class="assistant-label">ENGINEERING INTELLIGENCE</span><span class="status-dot" id="assistant-health" title="Checking"></span></header>
    <div class="assistant-body" id="assistant-body"><div class="assistant-empty"><div class="cortex-mark">C</div><h2>What are we building?</h2><p>Ask naturally. Cortex chooses context, tools, authority and verification automatically.</p><div class="suggestions"><button data-intent="Explain this repository">Explain this repository</button><button data-intent="Fix this failure">Fix this failure</button><button data-intent="What breaks if I change this?">What breaks if I change this?</button><button data-intent="Ship this safely">Ship this safely</button></div></div></div>
    <form class="composer" id="assistant-form"><textarea id="assistant-input" rows="3" placeholder="Ask Cortex anything…" aria-label="Ask Cortex"></textarea><div class="composer-footer"><span id="context-label">Open a workspace</span><button type="submit" title="Send">↑</button></div></form>
  </aside>
  <footer class="status-bar"><span id="git-branch">⑂ —</span><span id="error-count">✓ 0</span><span id="warning-count">⚠ 0</span><span class="status-grow"></span><button id="health-status" title="Cortex subsystem health">Health: checking</button><span id="cursor-position">Ln 1, Col 1</span><span>UTF-8</span><span id="language">Plain Text</span><span id="cortex-status">Starting…</span></footer>
</div>
<div id="command-palette" hidden style="position:fixed;left:50%;top:72px;transform:translateX(-50%);width:min(720px,80vw);z-index:1000;background:#1e1e1e;border:1px solid #555;box-shadow:0 12px 40px #000;padding:8px"><input id="command-input" style="width:100%;box-sizing:border-box;padding:10px;background:#252526;color:#fff;border:1px solid #555" placeholder="Type a Cortex command"/><div id="command-results"></div></div>`;

const editor = monaco.editor.create(document.querySelector('#editor'), {
  value: '', language: 'plaintext', theme: 'vs-dark', automaticLayout: true,
  fontSize: Number(state.settings.fontSize || 14), lineHeight: 22, minimap: { enabled: state.settings.minimap !== false },
  bracketPairColorization: { enabled: true }, stickyScroll: { enabled: true }, smoothScrolling: true,
});

const $ = (selector) => document.querySelector(selector);
const setStatus = (text) => { $('#cortex-status').textContent = text; };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const languageFor = (path='') => ({js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',json:'json',html:'html',css:'css',md:'markdown',py:'python',rs:'rust',go:'go',java:'java',c:'c',cpp:'cpp',h:'cpp',sh:'shell',yaml:'yaml',yml:'yaml'}[path.split('.').pop()?.toLowerCase()] || 'plaintext');

function showOutput(text, panel='output') {
  state.panel = panel;
  document.querySelectorAll('[data-panel]').forEach(b => b.classList.toggle('active', b.dataset.panel === panel));
  const body = $('#panel-body');
  body.innerHTML = `<pre style="white-space:pre-wrap;margin:0">${escapeHtml(text || '')}</pre>`;
}

function renderEmptyExplorer() {
  $('#side-title').textContent = 'EXPLORER';
  $('#side-content').innerHTML = `<div class="empty-side"><strong>CORTEX</strong><span>Open a folder to begin.</span><button id="empty-open-folder">Open Folder</button></div>`;
  $('#empty-open-folder')?.addEventListener('click', chooseWorkspace);
}

async function chooseWorkspace() {
  try {
    const selected = await open({ directory: true, multiple: false, title: 'Open Cortex Workspace' });
    if (!selected) return;
    await setWorkspace(selected);
  } catch (error) { fail('workspace-dialog', error); }
}

async function setWorkspace(path) {
  setStatus('Opening workspace…');
  try {
    state.workspace = await invoke('set_workspace', { path });
    state.explorerPath = '';
    $('#context-label').textContent = state.workspace.split(/[\\/]/).at(-1);
    await renderExplorer();
    await refreshGit();
    markHealthy('workspace');
    window.dispatchEvent(new CustomEvent('cortex-workspace-changed', { detail: { path: state.workspace } }));
    setStatus('Cortex Ready');
  } catch (error) { fail('workspace', error); }
}

async function renderExplorer(relative = state.explorerPath) {
  if (!state.workspace) return renderEmptyExplorer();
  state.explorerPath = relative || '';
  $('#side-title').textContent = 'EXPLORER';
  try {
    const entries = await invoke('list_workspace', { relative: state.explorerPath || null });
    const side = $('#side-content'); side.replaceChildren();
    const rootRow = document.createElement('button'); rootRow.className='workspace-row expanded'; rootRow.textContent=`⌄ ${state.workspace.split(/[\\/]/).at(-1).toUpperCase()}`; rootRow.onclick=()=>renderExplorer(''); side.append(rootRow);
    if (state.explorerPath) { const up=document.createElement('button'); up.className='file-row'; up.textContent='↰  ..'; up.onclick=()=>renderExplorer(state.explorerPath.split('/').slice(0,-1).join('/')); side.append(up); }
    for (const entry of entries) {
      const row=document.createElement('button'); row.className='file-row'; row.dataset.path=entry.relative_path; row.textContent=`${entry.is_directory?'▸':'·'}  ${entry.name}`;
      row.onclick=()=>entry.is_directory?renderExplorer(entry.relative_path):openFile(entry.relative_path);
      row.oncontextmenu=(event)=>{event.preventDefault();manageEntry(entry);}; side.append(row);
    }
    markHealthy('explorer');
  } catch (error) { fail('explorer', error); }
}

async function openFile(path) {
  try {
    let model=state.models.get(path);
    if (!model) {
      const text=await invoke('read_workspace_file',{relative:path});
      model=monaco.editor.createModel(text,languageFor(path),monaco.Uri.parse(`cortex://workspace/${path}`));
      state.models.set(path,model); state.savedVersions.set(path,model.getAlternativeVersionId());
      model.onDidChangeContent(()=>renderTabs());
    }
    state.activePath=path; editor.setModel(model); editor.focus(); renderTabs(); updateEditorStatus(); markHealthy('editor');
  } catch (error) { fail('editor', error); }
}

function isDirty(path) { const model=state.models.get(path); return model && state.savedVersions.get(path)!==model.getAlternativeVersionId(); }
function renderTabs() {
  const tabs=$('#tabs'); tabs.replaceChildren();
  for (const [path,model] of state.models) {
    const tab=document.createElement('div'); tab.className=`tab ${path===state.activePath?'active':''}`;
    const select=document.createElement('button'); select.className='tab-open'; select.textContent=`${path.split('/').at(-1)}${isDirty(path)?' •':''}`; select.onclick=()=>{state.activePath=path;editor.setModel(model);renderTabs();updateEditorStatus();};
    const close=document.createElement('button');close.className='tab-close';close.textContent='×';close.onclick=(e)=>{e.stopPropagation();closeFile(path);};tab.append(select,close);tabs.append(tab);
  }
}
function closeFile(path) { if (isDirty(path) && !confirm(`Discard unsaved changes in ${path}?`)) return; const model=state.models.get(path); if(!model)return; if(editor.getModel()===model)editor.setModel(null); model.dispose(); state.models.delete(path);state.savedVersions.delete(path); if(state.activePath===path)state.activePath=null;renderTabs();updateEditorStatus(); }
async function saveActive() { const path=state.activePath, model=path&&state.models.get(path); if(!model)return; try{await invoke('write_workspace_file',{relative:path,text:model.getValue()});state.savedVersions.set(path,model.getAlternativeVersionId());renderTabs();setStatus(`Saved ${path}`);markHealthy('save');}catch(error){fail('save',error);} }

async function createEntry(kind) { if(!state.workspace)return chooseWorkspace(); const name=prompt(`${kind==='file'?'New file':'New folder'} name`)?.trim(); if(!name)return; const relative=[state.explorerPath,name].filter(Boolean).join('/'); try{await invoke(kind==='file'?'create_workspace_file':'create_workspace_directory',{relative});await renderExplorer();if(kind==='file')await openFile(relative);}catch(error){fail('filesystem',error);} }
async function manageEntry(entry) { const action=prompt(`Manage ${entry.relative_path}: rename or delete`,'rename')?.trim().toLowerCase(); if(action==='rename'){const next=prompt('New name',entry.name)?.trim();if(!next)return;const parent=entry.relative_path.split('/').slice(0,-1).join('/');const destination=[parent,next].filter(Boolean).join('/');try{await invoke('rename_workspace_entry',{relative:entry.relative_path,destination});await renderExplorer();}catch(error){fail('filesystem',error);}}else if(action==='delete'&&confirm(`Permanently delete ${entry.relative_path}?`)){try{await invoke('delete_workspace_entry',{relative:entry.relative_path});if(state.models.has(entry.relative_path))closeFile(entry.relative_path);await renderExplorer();}catch(error){fail('filesystem',error);}} }

async function renderSearch() { $('#side-title').textContent='SEARCH'; $('#side-content').innerHTML='<form id="search-form" class="search-form"><input id="search-input" placeholder="Search workspace"/><button>⌕</button></form><div id="search-results"></div>'; $('#search-form').onsubmit=async e=>{e.preventDefault();const query=$('#search-input').value.trim();if(!query||!state.workspace)return;try{const matches=await invoke('search_workspace',{query});const out=$('#search-results');out.replaceChildren();for(const m of matches){const b=document.createElement('button');b.className='search-result';b.textContent=`${m.relative_path}:${m.line}  ${m.preview}`;b.onclick=async()=>{await openFile(m.relative_path);editor.setPosition({lineNumber:m.line,column:1});editor.revealLineInCenter(m.line);};out.append(b);}markHealthy('search');}catch(error){fail('search',error);}}; $('#search-input').focus(); }

async function refreshGit() { if(!state.workspace){$('#git-branch').textContent='⑂ —';return;} try{const result=await invoke('git_status');const branch=result.stdout.split(/\r?\n/).find(l=>l.startsWith('##'))?.slice(3).split('...')[0]||'—';$('#git-branch').textContent=`⑂ ${branch}`;markHealthy('git');}catch(error){$('#git-branch').textContent='⑂ !';} }
async function renderGit() { $('#side-title').textContent='SOURCE CONTROL'; if(!state.workspace){$('#side-content').innerHTML='<div class="empty-side">Open a workspace first.</div>';return;} try{const result=await invoke('git_status');const lines=result.stdout.split(/\r?\n/).filter(l=>l&&!l.startsWith('##'));const side=$('#side-content');side.replaceChildren();const form=document.createElement('form');form.className='scm-commit';form.innerHTML='<textarea id="commit-message" rows="2" placeholder="Commit message"></textarea><div><button type="button" id="stage-all">Stage All</button><button>Commit</button></div>';form.onsubmit=async e=>{e.preventDefault();const message=$('#commit-message').value.trim();if(!message)return;const r=await invoke('git_commit',{message});showOutput(r.stdout||r.stderr||'Commit complete');await renderGit();await refreshGit();};form.querySelector('#stage-all').onclick=async()=>{const paths=lines.map(l=>l.slice(3).trim().replace(/^.* -> /,''));if(paths.length)await invoke('git_stage',{paths});await renderGit();};side.append(form);for(const line of lines){const path=line.slice(3).trim().replace(/^.* -> /,'');const row=document.createElement('div');row.className='scm-change';const file=document.createElement('button');file.className='scm-file';file.textContent=`${line.slice(0,2)}  ${path}`;file.onclick=()=>openFile(path);const diff=document.createElement('button');diff.textContent='Δ';diff.onclick=async()=>{const r=await invoke('git_diff',{relative:path});showOutput(r.stdout||r.stderr);};const stage=document.createElement('button');stage.textContent='＋';stage.onclick=async()=>{await invoke('git_stage',{paths:[path]});await renderGit();};row.append(file,diff,stage);side.append(row);}markHealthy('git');}catch(error){fail('git',error);} }

async function renderTasks() { $('#side-title').textContent='RUN AND DEBUG'; if(!state.workspace){$('#side-content').innerHTML='<div class="empty-side">Open a workspace first.</div>';return;} try{const tasks=await invoke('discover_project_tasks');const side=$('#side-content');side.replaceChildren();if(!tasks.length){side.innerHTML='<div class="empty-side">No project tasks detected.</div>';return;}for(const task of tasks){const b=document.createElement('button');b.className='task-row';b.innerHTML=`<strong>${escapeHtml(task.name)}</strong><small>${escapeHtml(task.command)}</small>`;b.onclick=async()=>{setStatus(`Running ${task.name}…`);try{const r=await invoke('run_project_task',{task});showOutput((r.stdout||'')+(r.stderr?`\n${r.stderr}`:''),'output');markHealthy('tasks');}catch(error){fail('tasks',error);}finally{setStatus('Cortex Ready');}};side.append(b);} }catch(error){fail('tasks',error);} }

async function ensureTerminal() { state.panel='terminal';document.querySelectorAll('[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel==='terminal'));const body=$('#panel-body');if(!state.terminal){body.replaceChildren();const host=document.createElement('div');host.style.height='100%';body.append(host);const term=new Terminal({convertEol:true,fontSize:13,theme:{background:'#181818'}});const fit=new FitAddon();term.loadAddon(fit);term.open(host);fit.fit();try{const started=await invoke('pty_start',{cols:term.cols,rows:term.rows});state.terminalId=started.id??started;state.terminal=term;term.onData(data=>invoke('pty_write',{id:state.terminalId,data}).catch(error=>fail('terminal',error)));const pump=async()=>{if(!state.terminalId)return;try{const chunk=await invoke('pty_read',{id:state.terminalId});if(chunk)term.write(typeof chunk==='string'?chunk:(chunk.data||''));markHealthy('terminal');}catch(error){fail('terminal',error);return;}state.terminalPump=setTimeout(pump,40);};pump();window.addEventListener('resize',()=>{fit.fit();invoke('pty_resize',{id:state.terminalId,cols:term.cols,rows:term.rows}).catch(()=>{});});}catch(error){fail('terminal',error);}}else{body.replaceChildren(state.terminal.element);state.terminal.focus();} }

function renderSettings() { $('#side-title').textContent='SETTINGS';$('#side-content').innerHTML=`<div style="padding:12px;display:grid;gap:12px"><label>Font size <input id="setting-font" type="number" min="10" max="28" value="${Number(state.settings.fontSize||14)}"></label><label><input id="setting-minimap" type="checkbox" ${state.settings.minimap!==false?'checked':''}> Minimap</label><button id="save-settings">Apply Settings</button><button id="show-health">Show Subsystem Health</button></div>`;$('#save-settings').onclick=()=>{state.settings.fontSize=Number($('#setting-font').value);state.settings.minimap=$('#setting-minimap').checked;localStorage.setItem('cortex.settings',JSON.stringify(state.settings));editor.updateOptions({fontSize:state.settings.fontSize,minimap:{enabled:state.settings.minimap}});setStatus('Settings applied');};$('#show-health').onclick=showHealth; }
function renderExtensions() { $('#side-title').textContent='EXTENSIONS';$('#side-content').innerHTML='<div class="empty-side"><strong>Extension Platform</strong><span>Compatibility and isolated execution are provided by Cortex services. Marketplace workflow is being qualified separately.</span></div>'; }

async function submitAssistant(text) { const input=(text||$('#assistant-input').value).trim();if(!input)return;$('#assistant-input').value='';const body=$('#assistant-body');body.innerHTML=`<div style="padding:12px"><strong>You</strong><p>${escapeHtml(input)}</p><p class="muted">Cortex is gathering repository, editor, diagnostics and Git evidence…</p></div>`;const api=import.meta.env.VITE_CORTEX_COMMERCIAL_API_URL; if(!api){body.innerHTML+=`<div style="padding:12px"><strong>Cortex</strong><p>The hosted engineering runtime is not configured in this build. Local IDE functions remain available; Cortex will not fabricate an AI answer.</p></div>`;markDegraded('assistant','hosted API not configured');return;}try{const context=[];if(state.activePath){const model=state.models.get(state.activePath);context.push({kind:'editor',path:state.activePath,text:model?.getValue().slice(0,30000)});}if(state.workspace)context.push({kind:'workspace',path:state.workspace});const result=await invoke('commercial_assistant',{apiUrl:api,input,context});body.innerHTML+=`<div style="padding:12px"><strong>Cortex</strong><pre style="white-space:pre-wrap">${escapeHtml(result.output||result.message||JSON.stringify(result,null,2))}</pre></div>`;markHealthy('assistant');}catch(error){fail('assistant',error);body.innerHTML+=`<div style="padding:12px"><strong>Cortex</strong><p>${escapeHtml(String(error))}</p></div>`;} }

function updateEditorStatus(){const position=editor.getPosition()||{lineNumber:1,column:1};$('#cursor-position').textContent=`Ln ${position.lineNumber}, Col ${position.column}`;$('#language').textContent=state.activePath?languageFor(state.activePath):'Plain Text';}
function markHealthy(name){state.health.set(name,{status:'pass',detail:'ready'});renderHealthStatus();}
function markDegraded(name,detail){state.health.set(name,{status:'partial',detail});renderHealthStatus();}
function fail(name,error){state.health.set(name,{status:'fail',detail:String(error)});renderHealthStatus();setStatus(`${name} failed`);showOutput(`${name}: ${error}`);console.error(`[Cortex:${name}]`,error);}
function renderHealthStatus(){const values=[...state.health.values()];const failed=values.filter(v=>v.status==='fail').length;const degraded=values.filter(v=>v.status==='partial').length;$('#health-status').textContent=failed?`Health: ${failed} failed`:degraded?`Health: ${degraded} degraded`:'Health: ready';$('#assistant-health').style.opacity=failed?'.35':'1';}
function showHealth(){showOutput([...state.health.entries()].map(([name,v])=>`${name.padEnd(18)} ${v.status.toUpperCase()}  ${v.detail}`).join('\n')||'No subsystem checks have run yet.','output');}

const commands=[
  ['Open Folder',chooseWorkspace],['Save File',saveActive],['Search Workspace',renderSearch],['Source Control',renderGit],['Run Project Task',renderTasks],['Open Terminal',ensureTerminal],['Settings',renderSettings],['Subsystem Health',showHealth],
];
function toggleCommandPalette(){const palette=$('#command-palette');state.commandPaletteOpen=!state.commandPaletteOpen;palette.hidden=!state.commandPaletteOpen;if(state.commandPaletteOpen){$('#command-input').value='';renderCommandResults('');$('#command-input').focus();}}
function renderCommandResults(query){const out=$('#command-results');out.replaceChildren();for(const [name,action] of commands.filter(([name])=>name.toLowerCase().includes(query.toLowerCase()))){const b=document.createElement('button');b.style.cssText='display:block;width:100%;padding:9px;text-align:left;background:transparent;color:#fff;border:0';b.textContent=name;b.onclick=()=>{toggleCommandPalette();action();};out.append(b);}}

async function boot(){renderEmptyExplorer();markHealthy('workbench');try{await invoke('runtime_info');markHealthy('native-runtime');}catch(error){fail('native-runtime',error);}try{const restored=await invoke('restore_workspace_session');if(restored?.workspace){await setWorkspace(restored.workspace);for(const file of restored.open_files||[]){try{await openFile(file);}catch{}}}}catch{markDegraded('recovery','no restorable session');}setStatus('Cortex Ready');renderHealthStatus();}

document.addEventListener('click',(event)=>{const view=event.target.closest('[data-view]')?.dataset.view;if(view){state.activeView=view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='explorer')renderExplorer();if(view==='search')renderSearch();if(view==='source-control')renderGit();if(view==='run')renderTasks();if(view==='extensions')renderExtensions();if(view==='settings')renderSettings();}const panel=event.target.closest('[data-panel]')?.dataset.panel;if(panel){if(panel==='terminal')ensureTerminal();else{state.panel=panel;document.querySelectorAll('[data-panel]').forEach(b=>b.classList.toggle('active',b.dataset.panel===panel));if(panel==='problems')showOutput('No current diagnostics.','problems');else showOutput('',panel);}}const intent=event.target.closest('[data-intent]')?.dataset.intent;if(intent)submitAssistant(intent);});
$('#open-folder').onclick=chooseWorkspace;$('#new-file').onclick=()=>createEntry('file');$('#new-folder').onclick=()=>createEntry('directory');$('#clear-panel').onclick=()=>showOutput('',state.panel);$('#health-status').onclick=showHealth;$('#assistant-form').onsubmit=e=>{e.preventDefault();submitAssistant();};
$('#command-input').oninput=e=>renderCommandResults(e.target.value);$('#command-input').onkeydown=e=>{if(e.key==='Escape')toggleCommandPalette();};
editor.onDidChangeCursorPosition(updateEditorStatus);
window.addEventListener('keydown',event=>{const mod=event.ctrlKey||event.metaKey;if(mod&&event.key.toLowerCase()==='s'){event.preventDefault();saveActive();}else if(mod&&event.key.toLowerCase()==='o'){event.preventDefault();chooseWorkspace();}else if(mod&&event.key.toLowerCase()==='p'){event.preventDefault();toggleCommandPalette();}else if(mod&&event.shiftKey&&event.key.toLowerCase()==='f'){event.preventDefault();renderSearch();}else if(mod&&event.key==='`'){event.preventDefault();ensureTerminal();}});
window.addEventListener('beforeunload',()=>{if(state.terminalId)invoke('pty_stop',{id:state.terminalId}).catch(()=>{});clearTimeout(state.terminalPump);});

window.CortexWorkbench={getState:()=>({workspace:state.workspace,activePath:state.activePath,openFiles:[...state.models.keys()],health:Object.fromEntries(state.health)}),chooseWorkspace,setWorkspace,openFile,saveActive,renderSearch,renderGit,renderTasks,ensureTerminal,submitAssistant,showHealth};
boot();
