import * as monaco from 'monaco-editor';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import './vscode-freedom.css';

const api = () => window.CortexWorkbench;
const state = { untitled: 0, activeUntitled: null, splitEditor: null, terminals: [], activeTerminal: null, quickOpen: null, notifications: [] };
const commands = new Map();
const $ = s => document.querySelector(s);

function notify(message, kind='info') {
  const host = document.getElementById('cortex-notifications') || createNotifications();
  const item = document.createElement('div'); item.className=`cortex-notification ${kind}`; item.textContent=message;
  const close=document.createElement('button');close.textContent='×';close.onclick=()=>item.remove();item.append(close);host.append(item);setTimeout(()=>item.remove(),8000);
}
function createNotifications(){const host=document.createElement('div');host.id='cortex-notifications';document.body.append(host);return host;}
function register(id,label,run,when=()=>true){commands.set(id,{id,label,run,when});}
function run(id){const command=commands.get(id);if(command?.when())return Promise.resolve(command.run());}

function installCommandPalette(){
  const old=$('#command-palette'); if(old) old.remove();
  const palette=document.createElement('div');palette.id='command-palette';palette.className='cortex-quick-pick';palette.hidden=true;
  palette.innerHTML='<input id="command-input" aria-label="Command Palette" placeholder="> Type a command"><div id="command-results" class="quick-results"></div>';
  document.body.append(palette);
  const input=palette.querySelector('input');
  const render=()=>{const q=input.value.replace(/^>/,'').trim().toLowerCase();const out=palette.querySelector('.quick-results');out.replaceChildren();for(const command of [...commands.values()].filter(c=>c.when()&&(`${c.label} ${c.id}`).toLowerCase().includes(q)).slice(0,80)){const b=document.createElement('button');b.innerHTML=`<span>${escapeHtml(command.label)}</span><small>${escapeHtml(command.id)}</small>`;b.onclick=async()=>{palette.hidden=true;await command.run();};out.append(b);} };
  input.oninput=render;input.onkeydown=e=>{if(e.key==='Escape')palette.hidden=true;if(e.key==='Enter'){palette.querySelector('.quick-results button')?.click();}};
  window.CortexCommands={register,run,list:()=>[...commands.values()].map(({id,label})=>({id,label})),open(){palette.hidden=false;input.value='>';render();input.focus();}};
}

function newUntitled(){
  const name=`Untitled-${++state.untitled}`;const model=monaco.editor.createModel('', 'plaintext', monaco.Uri.parse(`untitled:${name}`));state.activeUntitled={name,model};
  const host=$('#editor');host?.focus();const editors=monaco.editor.getEditors?.()||[];editors[0]?.setModel(model);notify(`${name} created`);return model;
}
async function openSingleFile(){const path=await open({multiple:false,directory:false,title:'Open File'});if(!path)return;const parent=String(path).replace(/[\\/][^\\/]+$/,'');const name=String(path).split(/[\\/]/).at(-1);await api()?.setWorkspace(parent);await api()?.openFile(name);}
async function saveUntitledAs(){if(!state.activeUntitled)return api()?.saveActive?.();const path=await save({title:'Save As'});if(!path)return;await invoke('write_user_selected_file',{path,text:state.activeUntitled.model.getValue()});notify(`Saved ${path}`);}

function splitEditor(){const host=$('#editor-host');if(!host||state.splitEditor)return;const primary=monaco.editor.getEditors?.()[0];const model=primary?.getModel?.();if(!model){notify('Open a file before splitting the editor','warning');return;}host.classList.add('split');const node=document.createElement('div');node.className='editor';node.setAttribute('aria-label','Secondary Editor');host.append(node);state.splitEditor=monaco.editor.create(node,{model,theme:document.documentElement.dataset.theme==='light'?'vs':'vs-dark',automaticLayout:true,minimap:{enabled:false}});}
function closeSplit(){state.splitEditor?.dispose();state.splitEditor=null;$('#editor-host')?.classList.remove('split');$('#editor-host .editor:nth-child(2)')?.remove();}

async function newTerminal(){const body=$('#panel-body');document.querySelector('[data-panel="terminal"]')?.click();const shell=document.createElement('section');shell.className='terminal-instance';const header=document.createElement('header');const title=document.createElement('button');title.textContent=`Terminal ${state.terminals.length+1}`;const close=document.createElement('button');close.textContent='×';const host=document.createElement('div');host.className='terminal-instance-host';header.append(title,close);shell.append(header,host);body.append(shell);const term=new Terminal({convertEol:true,fontSize:13});const fit=new FitAddon();term.loadAddon(fit);term.open(host);fit.fit();const started=await invoke('pty_start',{cols:term.cols,rows:term.rows});const item={id:started.id??started,term,shell,fit};state.terminals.push(item);state.activeTerminal=item;term.onData(data=>invoke('pty_write',{id:item.id,data}));const pump=async()=>{if(!state.terminals.includes(item))return;try{const chunk=await invoke('pty_read',{id:item.id});if(chunk)term.write(typeof chunk==='string'?chunk:(chunk.data||''));setTimeout(pump,40);}catch(e){notify(String(e),'error');}};pump();title.onclick=()=>{state.activeTerminal=item;term.focus();};close.onclick=async()=>{await invoke('pty_stop',{id:item.id}).catch(()=>{});term.dispose();shell.remove();state.terminals=state.terminals.filter(t=>t!==item);};}

function applyTheme(name){localStorage.setItem('cortex.theme',name);document.documentElement.dataset.theme=name;monaco.editor.setTheme(name==='light'?'vs':name==='high-contrast'?'hc-black':'vs-dark');}
function renderSettings(){document.querySelector('.activity[data-view="settings"]')?.click();const side=$('#side-content');if(!side)return;side.insertAdjacentHTML('beforeend','<section class="freedom-settings"><h3>Workbench</h3><label>Theme<select id="freedom-theme"><option value="dark">Dark</option><option value="light">Light</option><option value="high-contrast">High Contrast</option></select></label><button id="keyboard-shortcuts">Keyboard Shortcuts</button><button id="settings-json">Open Settings JSON</button></section>');const theme=$('#freedom-theme');theme.value=localStorage.getItem('cortex.theme')||'dark';theme.onchange=()=>applyTheme(theme.value);$('#keyboard-shortcuts').onclick=showKeybindings;$('#settings-json').onclick=showSettingsJson;}
function showKeybindings(){showVirtualDocument('Keyboard Shortcuts', [['Ctrl/Cmd+Shift+P','Command Palette'],['Ctrl/Cmd+P','Quick Open'],['Ctrl/Cmd+N','New Untitled File'],['Ctrl/Cmd+O','Open File'],['Ctrl/Cmd+S','Save'],['Ctrl/Cmd+Shift+S','Save As'],['Ctrl/Cmd+\\','Split Editor'],['Ctrl/Cmd+`','Terminal'],['Ctrl/Cmd+Shift+`','New Terminal'],['F5','Start Debugging'],['F9','Toggle Breakpoint']].map(x=>x.join('    ')).join('\n'));}
function showSettingsJson(){showVirtualDocument('settings.json',JSON.stringify({theme:localStorage.getItem('cortex.theme')||'dark',...JSON.parse(localStorage.getItem('cortex.settings')||'{}')},null,2));}
function showVirtualDocument(title,text){const body=$('#panel-body');body.innerHTML=`<h3>${escapeHtml(title)}</h3><pre>${escapeHtml(text)}</pre>`;}

function quickOpen(){const files=api()?.getState?.().openFiles||[];const value=prompt(`Quick Open\n${files.join('\n')}\n\nType a workspace path:`)?.trim();if(value)api()?.openFile?.(value);}
function goLine(){const editor=monaco.editor.getEditors?.()[0];const line=Number(prompt('Go to line:'));if(editor&&line>0){editor.setPosition({lineNumber:line,column:1});editor.revealLineInCenter(line);editor.focus();}}
function goSymbol(){const editor=monaco.editor.getEditors?.()[0];const model=editor?.getModel();if(!model)return;const q=prompt('Go to symbol:')?.trim();if(!q)return;const match=model.findMatches(q,false,false,false,null,true)[0];if(match){editor.setPosition(match.range.getStartPosition());editor.revealRangeInCenter(match.range);editor.focus();}}
function toggleAssistant(){const panel=$('.assistant');panel?.classList.toggle('assistant-hidden');}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function installCommands(){
  register('workbench.action.showCommands','View: Show Command Palette',()=>window.CortexCommands.open());register('workbench.action.quickOpen','Go to File…',quickOpen);register('workbench.action.gotoLine','Go to Line…',goLine);register('workbench.action.gotoSymbol','Go to Symbol…',goSymbol);
  register('workbench.action.files.newUntitledFile','File: New Text File',newUntitled);register('workbench.action.files.openFile','File: Open File…',openSingleFile);register('workbench.action.files.openFolder','File: Open Folder…',()=>api()?.chooseWorkspace?.());register('workbench.action.files.save','File: Save',()=>state.activeUntitled?saveUntitledAs():api()?.saveActive?.());register('workbench.action.files.saveAs','File: Save As…',saveUntitledAs);
  register('workbench.action.splitEditorRight','View: Split Editor Right',splitEditor);register('workbench.action.closeEditorsInGroup','View: Close Secondary Editor',closeSplit,()=>Boolean(state.splitEditor));
  register('workbench.action.terminal.new','Terminal: Create New Terminal',newTerminal);register('workbench.action.terminal.focus','Terminal: Focus Terminal',()=>state.activeTerminal?.term.focus());
  register('workbench.action.openSettings','Preferences: Open Settings',renderSettings);register('workbench.action.openGlobalKeybindings','Preferences: Open Keyboard Shortcuts',showKeybindings);register('workbench.action.selectTheme','Preferences: Color Theme',()=>{const t=prompt('Theme: dark, light, high-contrast',localStorage.getItem('cortex.theme')||'dark');if(['dark','light','high-contrast'].includes(t))applyTheme(t);});
  register('workbench.view.explorer','View: Explorer',()=>document.querySelector('.activity[data-view="explorer"]')?.click());register('workbench.view.search','View: Search',()=>document.querySelector('.activity[data-view="search"]')?.click());register('workbench.view.scm','View: Source Control',()=>document.querySelector('.activity[data-view="source-control"]')?.click());register('workbench.view.debug','View: Run and Debug',()=>document.querySelector('.activity[data-view="run"]')?.click());register('workbench.view.extensions','View: Extensions',()=>document.querySelector('.activity[data-view="extensions"]')?.click());register('workbench.action.toggleCortexAI','View: Toggle Cortex AI',toggleAssistant);
}

function installKeys(){window.addEventListener('keydown',e=>{const mod=e.ctrlKey||e.metaKey;const key=e.key.toLowerCase();if(mod&&e.shiftKey&&key==='p'){e.preventDefault();window.CortexCommands.open();}else if(mod&&key==='p'){e.preventDefault();quickOpen();}else if(mod&&key==='n'){e.preventDefault();newUntitled();}else if(mod&&key==='o'){e.preventDefault();openSingleFile();}else if(mod&&e.shiftKey&&key==='s'){e.preventDefault();saveUntitledAs();}else if(mod&&key==='\\'){e.preventDefault();splitEditor();}else if(mod&&e.shiftKey&&e.key==='`'){e.preventDefault();newTerminal();}else if(e.key==='F1'){e.preventDefault();window.CortexCommands.open();}} ,true);}

applyTheme(localStorage.getItem('cortex.theme')||'dark');installCommandPalette();installCommands();installKeys();createNotifications();window.CortexFreedom={commands,newUntitled,openSingleFile,saveUntitledAs,splitEditor,newTerminal,applyTheme,notify};
