import './title-bar.css';

const workbench = document.querySelector('.workbench');
if (workbench) installTitleBar(workbench);

function installTitleBar(host) {
  const bar = document.createElement('header');
  bar.className = 'cortex-title-bar';
  bar.innerHTML = `<div class="title-brand"><span class="title-mark">C</span></div><nav class="menu-bar" aria-label="Application Menu"></nav><button class="command-center" title="Command Palette (Ctrl+Shift+P)"><span>⌕</span><span class="command-center-text">Cortex</span></button><div class="title-spacer"></div><div class="title-context">Engineering Intelligence</div>`;
  host.prepend(bar);
  const menus = {
    File: [['Open Folder…',()=>document.getElementById('open-folder')?.click()],['Save',()=>shortcut('s')]],
    Edit: [['Command Palette…',()=>shortcut('p',true)]],
    Selection: [['Command Palette…',()=>shortcut('p',true)]],
    View: [['Explorer',()=>view('explorer')],['Search',()=>view('search')],['Source Control',()=>view('source-control')],['Terminal',()=>document.querySelector('[data-panel="terminal"]')?.click()],['Extensions',()=>view('extensions')]],
    Go: [['Command Palette…',()=>shortcut('p',true)]],
    Run: [['Run and Debug',()=>view('run')],['Terminal',()=>document.querySelector('[data-panel="terminal"]')?.click()]],
    Terminal: [['New Terminal',()=>document.querySelector('[data-panel="terminal"]')?.click()]],
    Help: [['About Cortex',showAbout]],
  };
  const nav=bar.querySelector('.menu-bar');
  for(const [label,items] of Object.entries(menus)){
    const wrapper=document.createElement('div');wrapper.className='menu-wrapper';
    const button=document.createElement('button');button.className='menu-button';button.textContent=label;
    const panel=document.createElement('div');panel.className='menu-panel';panel.hidden=true;
    for(const [itemLabel,run] of items){const item=document.createElement('button');item.textContent=itemLabel;item.onclick=()=>{closeMenus();run();};panel.append(item);}
    button.onclick=(event)=>{event.stopPropagation();const open=panel.hidden;closeMenus();panel.hidden=!open;};wrapper.append(button,panel);nav.append(wrapper);
  }
  bar.querySelector('.command-center').onclick=()=>shortcut('p',true);
  document.addEventListener('click',closeMenus);
  window.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenus();});
  window.addEventListener('cortex-workspace-changed',event=>{bar.querySelector('.command-center-text').textContent=event.detail?.name?`${event.detail.name} — Cortex`:'Cortex';});
}
function closeMenus(){document.querySelectorAll('.menu-panel').forEach(panel=>panel.hidden=true);}
function shortcut(key,shift=false){window.dispatchEvent(new KeyboardEvent('keydown',{key,ctrlKey:true,metaKey:navigator.platform.includes('Mac'),shiftKey:shift,bubbles:true}));}
function view(name){document.querySelector(`.activity[data-view="${name}"]`)?.click();}
function showAbout(){const body=document.querySelector('.assistant-body');if(!body)return;const card=document.createElement('article');card.className='assistant-message';card.textContent='Cortex · AI-native systems-aware software engineering environment. Familiar where familiarity helps. Different where architecture matters.';body.replaceChildren(card);}
