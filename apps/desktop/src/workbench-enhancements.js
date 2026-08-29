import * as monaco from 'monaco-editor';
import './workbench-enhancements.css';

installCommandPalette();
installWorkbenchViews();

function installCommandPalette() {
  const overlay = document.createElement('div');
  overlay.className = 'command-palette-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `<div class="command-palette" role="dialog" aria-modal="true" aria-label="Command Palette"><input aria-label="Command" placeholder="> Type a command" autocomplete="off"/><div class="command-results"></div></div>`;
  document.body.append(overlay);
  const input = overlay.querySelector('input');
  const results = overlay.querySelector('.command-results');
  const commands = [
    ['File: Open Folder','Ctrl+O',()=>document.getElementById('open-folder')?.click()],
    ['File: New File','',()=>document.getElementById('new-file')?.click()],
    ['File: New Folder','',()=>document.getElementById('new-folder')?.click()],
    ['File: Save','Ctrl+S',()=>dispatchShortcut('s')],
    ['File: Close Editor','Ctrl+W',()=>dispatchShortcut('w')],
    ['View: Explorer','Ctrl+Shift+E',()=>clickView('explorer')],
    ['View: Search','Ctrl+Shift+F',()=>clickView('search')],
    ['View: Source Control','Ctrl+Shift+G',()=>clickView('source-control')],
    ['View: Run and Debug','',()=>clickView('run')],
    ['View: Terminal','Ctrl+`',()=>document.querySelector('[data-panel="terminal"]')?.click()],
    ['View: Split Editor','Ctrl+\\',()=>window.cortexWorkbench?.splitEditor()],
    ['View: Toggle Cortex Assistant','',()=>document.querySelector('.assistant')?.classList.toggle('assistant-hidden')],
    ['Cortex: Check for Updates','',()=>window.dispatchEvent(new Event('cortex-check-updates'))],
    ['Preferences: Settings','Ctrl+,',()=>showSettings()],
    ['Preferences: Color Theme','',()=>toggleTheme()],
    ['Developer: Reload Window','',()=>location.reload()],
  ];
  function render() {
    const query=input.value.replace(/^>/,'').trim().toLowerCase(); results.replaceChildren();
    for(const [label,keybinding,run] of commands.filter(([label])=>!query||label.toLowerCase().includes(query)).slice(0,16)){
      const row=document.createElement('button'); row.className='command-row'; row.innerHTML=`<span>${escapeHtml(label)}</span><kbd>${escapeHtml(keybinding)}</kbd>`; row.onclick=()=>{close();run();}; results.append(row);
    }
  }
  function open(){overlay.hidden=false;input.value='>';render();requestAnimationFrame(()=>{input.focus();input.setSelectionRange(1,1);});}
  function close(){overlay.hidden=true;}
  input.addEventListener('input',render); input.addEventListener('keydown',event=>{if(event.key==='Escape')close();if(event.key==='Enter'){event.preventDefault();results.querySelector('button')?.click();}}); overlay.addEventListener('mousedown',event=>{if(event.target===overlay)close();});
  window.addEventListener('keydown',event=>{const mod=event.ctrlKey||event.metaKey;if(mod&&event.shiftKey&&event.key.toLowerCase()==='p'){event.preventDefault();open();}if(event.key==='F1'){event.preventDefault();open();}if(mod&&event.key===','){event.preventDefault();showSettings();}if(mod&&event.shiftKey&&event.key.toLowerCase()==='e'){event.preventDefault();clickView('explorer');}if(mod&&event.shiftKey&&event.key.toLowerCase()==='g'){event.preventDefault();clickView('source-control');}});
}

function installWorkbenchViews(){
  for(const button of document.querySelectorAll('.activity[data-view="settings"],.activity[data-view="extensions"]')) button.addEventListener('click',event=>{event.stopImmediatePropagation();document.querySelectorAll('.activity').forEach(item=>item.classList.remove('active'));button.classList.add('active');const view=button.dataset.view;if(view==='settings')showSettings();if(view==='extensions')showExtensions();},{capture:true});
}
function showSettings(){
  setSide('SETTINGS',`<div class="settings-page"><label>Editor theme<select id="cortex-theme"><option value="vs-dark">Dark</option><option value="vs">Light</option><option value="hc-black">High Contrast Dark</option></select></label><label class="setting-check"><input id="cortex-minimap" type="checkbox"/> Show minimap</label><p>Cortex keeps common defaults familiar while discovering project conventions automatically.</p><button id="reset-workbench">Reset workbench preferences</button></div>`);
  const theme=document.getElementById('cortex-theme');const minimap=document.getElementById('cortex-minimap');
  theme.value=localStorage.getItem('cortex.theme')||'vs-dark';minimap.checked=localStorage.getItem('cortex.minimap')!=='false';
  theme.onchange=()=>{localStorage.setItem('cortex.theme',theme.value);monaco.editor.setTheme(theme.value);};
  minimap.onchange=()=>{localStorage.setItem('cortex.minimap',String(minimap.checked));window.cortexWorkbench?.setMinimap(minimap.checked);};
  document.getElementById('reset-workbench').onclick=()=>{localStorage.removeItem('cortex.theme');localStorage.removeItem('cortex.minimap');monaco.editor.setTheme('vs-dark');window.cortexWorkbench?.setMinimap(true);theme.value='vs-dark';minimap.checked=true;};
}
function showExtensions(){setSide('EXTENSIONS',`<div class="settings-page"><strong>Cortex Extension Platform</strong><p>Extensions are capability-scoped, lazily activated, health-accounted and isolated from the workbench. VS Code compatibility is translated at the boundary instead of granting ambient IDE authority.</p><div class="extension-badge">Capability security</div><div class="extension-badge">Lazy activation</div><div class="extension-badge">Signature verification</div></div>`);}
function setSide(title,html){document.getElementById('side-title').textContent=title;document.getElementById('side-content').innerHTML=html;}
function clickView(view){document.querySelector(`.activity[data-view="${view}"]`)?.click();}
function dispatchShortcut(key){window.dispatchEvent(new KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true}));}
function toggleTheme(){const current=localStorage.getItem('cortex.theme')||'vs-dark';const next=current==='vs-dark'?'vs':'vs-dark';localStorage.setItem('cortex.theme',next);monaco.editor.setTheme(next);}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));}

const initialTheme=localStorage.getItem('cortex.theme')||'vs-dark';
monaco.editor.setTheme(initialTheme);
queueMicrotask(()=>window.cortexWorkbench?.setMinimap(localStorage.getItem('cortex.minimap')!=='false'));
