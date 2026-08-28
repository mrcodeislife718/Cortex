import * as monaco from 'monaco-editor';
import 'monaco-editor/min/vs/editor/editor.main.css';
import './styles.css';

const root = document.querySelector('#cortex-root');
root.innerHTML = `
  <div class="workbench" role="application" aria-label="Cortex IDE">
    <aside class="activity-bar" aria-label="Activity Bar">
      <button class="activity active" data-view="explorer" title="Explorer">▱</button>
      <button class="activity" data-view="search" title="Search">⌕</button>
      <button class="activity" data-view="source-control" title="Source Control">⑂</button>
      <button class="activity" data-view="run" title="Run and Debug">▷</button>
      <button class="activity" data-view="extensions" title="Extensions">◇</button>
      <span class="activity-spacer"></span>
      <button class="activity" data-view="settings" title="Settings">⚙</button>
    </aside>
    <aside class="side-bar" aria-label="Primary Side Bar">
      <header><strong id="side-title">EXPLORER</strong><button title="More actions">⋯</button></header>
      <section id="side-content" class="side-content">
        <button class="workspace-row expanded">⌄ CORTEX</button>
        <button class="file-row active">JS&nbsp;&nbsp;src/main.js</button>
        <button class="file-row">#&nbsp;&nbsp;README.md</button>
        <button class="file-row">{ }&nbsp;&nbsp;package.json</button>
      </section>
    </aside>
    <main class="center">
      <div class="tabs" role="tablist">
        <button class="tab active" role="tab">main.js <span>×</span></button>
      </div>
      <div id="editor" class="editor" aria-label="Editor"></div>
      <section class="panel" aria-label="Panel">
        <nav class="panel-tabs">
          <button class="active">PROBLEMS <span class="badge">0</span></button>
          <button>OUTPUT</button><button>DEBUG CONSOLE</button><button>TERMINAL</button>
          <span class="panel-grow"></span><button title="Maximize Panel">⌃</button><button title="Close Panel">×</button>
        </nav>
        <div class="panel-body"><span class="muted">No problems detected.</span></div>
      </section>
    </main>
    <aside class="assistant" aria-label="Cortex Assistant">
      <header><strong>CORTEX</strong><span class="status-dot" title="Ready"></span></header>
      <div class="assistant-body">
        <div class="assistant-empty">
          <div class="cortex-mark">C</div>
          <h2>What are we building?</h2>
          <p>Ask naturally. Cortex chooses the tools, context, agents, and verification depth.</p>
          <div class="suggestions">
            <button>Explain this repository</button><button>Fix this failure</button><button>What breaks if I change this?</button><button>Ship this safely</button>
          </div>
        </div>
      </div>
      <form class="composer" id="assistant-form">
        <textarea id="assistant-input" rows="3" placeholder="Ask Cortex anything…" aria-label="Ask Cortex"></textarea>
        <div class="composer-footer"><span id="context-label">Workspace context automatic</span><button type="submit" title="Send">↑</button></div>
      </form>
    </aside>
    <footer class="status-bar"><span>⑂ main</span><span>✓ 0</span><span>⚠ 0</span><span class="status-grow"></span><span>Ln 1, Col 1</span><span>UTF-8</span><span>JavaScript</span><span>Cortex Ready</span></footer>
  </div>`;

const editor = monaco.editor.create(document.getElementById('editor'), {
  value: `// Cortex\n// Familiar where it helps. Different where it matters.\n\nexport function build() {\n  return 'more capability, less burden';\n}\n`,
  language: 'javascript',
  automaticLayout: true,
  minimap: { enabled: true },
  fontSize: 14,
  lineHeight: 22,
  padding: { top: 12 },
  smoothScrolling: true,
  cursorSmoothCaretAnimation: 'on',
  renderWhitespace: 'selection',
  bracketPairColorization: { enabled: true },
  stickyScroll: { enabled: true },
});

for (const button of document.querySelectorAll('.activity')) {
  button.addEventListener('click', () => {
    document.querySelectorAll('.activity').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    const view = button.dataset.view ?? 'settings';
    document.getElementById('side-title').textContent = view.replace('-', ' ').toUpperCase();
  });
}

document.getElementById('assistant-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.getElementById('assistant-input');
  const value = input.value.trim();
  if (!value) return;
  const body = document.querySelector('.assistant-body');
  const item = document.createElement('div');
  item.className = 'assistant-message';
  item.textContent = value;
  body.replaceChildren(item);
  input.value = '';
  document.getElementById('context-label').textContent = 'Routing intent…';
});

editor.onDidChangeCursorPosition(({ position }) => {
  const status = [...document.querySelectorAll('.status-bar span')].find((node) => node.textContent.startsWith('Ln '));
  if (status) status.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
});
