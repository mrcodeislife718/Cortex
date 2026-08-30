import './title-bar.css';

const workbench = document.querySelector('.workbench');
if (workbench) installTitleBar(workbench);

function api() { return window.CortexWorkbench ?? null; }

function installTitleBar(host) {
  const bar = document.createElement('header');
  bar.className = 'cortex-title-bar';
  bar.innerHTML = `<div class="title-brand"><span class="title-mark">C</span></div><nav class="menu-bar" aria-label="Application Menu"></nav><button class="command-center" title="Command Palette (Ctrl+P)"><span>⌕</span><span class="command-center-text">Cortex</span></button><div class="title-spacer"></div><div class="title-context">Engineering Intelligence</div>`;
  host.prepend(bar);
  const menus = {
    File: [
      ['Open Folder…', () => api()?.chooseWorkspace?.()],
      ['Clone Repository…', () => window.dispatchEvent(new Event('cortex-git-clone'))],
      ['Save', () => api()?.saveActive?.()],
    ],
    Edit: [['Command Palette…', openCommandPalette]],
    Selection: [['Command Palette…', openCommandPalette]],
    View: [
      ['Explorer', () => view('explorer')],
      ['Search', () => api()?.renderSearch?.()],
      ['Source Control', () => api()?.renderGit?.()],
      ['Terminal', () => api()?.ensureTerminal?.()],
      ['Extensions', () => view('extensions')],
      ['Subsystem Health', () => api()?.showHealth?.()],
    ],
    Go: [['Command Palette…', openCommandPalette]],
    Run: [
      ['Run and Debug', () => api()?.renderTasks?.()],
      ['Terminal', () => api()?.ensureTerminal?.()],
    ],
    Terminal: [['New Terminal', () => api()?.ensureTerminal?.()]],
    Help: [
      ['Check for Updates…', () => window.dispatchEvent(new Event('cortex-check-updates'))],
      ['About Cortex', showAbout],
    ],
  };
  const nav = bar.querySelector('.menu-bar');
  for (const [label, items] of Object.entries(menus)) {
    const wrapper = document.createElement('div'); wrapper.className = 'menu-wrapper';
    const button = document.createElement('button'); button.className = 'menu-button'; button.textContent = label;
    const panel = document.createElement('div'); panel.className = 'menu-panel'; panel.hidden = true;
    for (const [itemLabel, run] of items) {
      const item = document.createElement('button'); item.textContent = itemLabel;
      item.onclick = () => { closeMenus(); try { run(); } catch (error) { console.error('[Cortex:title-bar]', error); api()?.showHealth?.(); } };
      panel.append(item);
    }
    button.onclick = (event) => { event.stopPropagation(); const open = panel.hidden; closeMenus(); panel.hidden = !open; };
    wrapper.append(button, panel); nav.append(wrapper);
  }
  bar.querySelector('.command-center').onclick = openCommandPalette;
  document.addEventListener('click', closeMenus);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenus(); });
  window.addEventListener('cortex-workspace-changed', event => {
    const path = event.detail?.path ?? '';
    const name = event.detail?.name ?? path.split(/[\\/]/).filter(Boolean).at(-1);
    bar.querySelector('.command-center-text').textContent = name ? `${name} — Cortex` : 'Cortex';
  });
}

function closeMenus() { document.querySelectorAll('.menu-panel').forEach(panel => panel.hidden = true); }
function view(name) { document.querySelector(`.activity[data-view="${name}"]`)?.click(); }
function openCommandPalette() { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, metaKey: navigator.platform.includes('Mac'), bubbles: true })); }
function showAbout() {
  const body = document.querySelector('.assistant-body'); if (!body) return;
  const card = document.createElement('article'); card.className = 'assistant-message';
  card.textContent = 'Cortex · Verifiable software factory and systems-aware engineering environment. Familiar where familiarity helps. Different where architecture matters.';
  body.replaceChildren(card);
}
