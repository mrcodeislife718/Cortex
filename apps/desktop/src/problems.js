import * as monaco from 'monaco-editor';

const button = document.querySelector('[data-panel="problems"]');

if (button) {
  button.addEventListener('click', (event) => {
    event.stopImmediatePropagation();
    activateProblems();
  }, { capture: true });
}

monaco.editor.onDidChangeMarkers(() => {
  updateCounts();
  if (button?.classList.contains('active')) renderProblems();
});

updateCounts();

function activateProblems() {
  document.querySelectorAll('[data-panel]').forEach((item) => item.classList.toggle('active', item === button));
  renderProblems();
}

function renderProblems() {
  const body = document.getElementById('panel-body');
  if (!body) return;
  body.classList.remove('pty-panel');
  body.replaceChildren();
  const markers = workspaceMarkers();
  if (!markers.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No problems detected.';
    body.append(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'problems-list';
  for (const marker of markers) {
    const row = document.createElement('button');
    row.className = `problem-row problem-${severityName(marker.severity)}`;
    const relative = relativePath(marker.resource);
    row.innerHTML = `<span class="problem-severity">${severityGlyph(marker.severity)}</span><span class="problem-message"></span><span class="problem-location"></span>`;
    row.querySelector('.problem-message').textContent = marker.message;
    row.querySelector('.problem-location').textContent = `${relative}:${marker.startLineNumber}:${marker.startColumn}`;
    row.title = `${marker.source ? `${marker.source}: ` : ''}${marker.message}`;
    row.onclick = async () => {
      try {
        await window.cortexWorkbench?.openFile?.(relative, { line: marker.startLineNumber });
      } catch {
        return;
      }
    };
    list.append(row);
  }
  body.append(list);
}

function workspaceMarkers() {
  return monaco.editor.getModelMarkers({})
    .filter((marker) => marker.resource?.scheme === 'cortex')
    .sort((a, b) => b.severity - a.severity || String(a.resource).localeCompare(String(b.resource)) || a.startLineNumber - b.startLineNumber)
    .slice(0, 5000);
}

function updateCounts() {
  const markers = workspaceMarkers();
  const errors = markers.filter((marker) => marker.severity === monaco.MarkerSeverity.Error).length;
  const warnings = markers.filter((marker) => marker.severity === monaco.MarkerSeverity.Warning).length;
  const errorNode = document.getElementById('error-count');
  const warningNode = document.getElementById('warning-count');
  const badge = button?.querySelector('.badge');
  if (errorNode) errorNode.textContent = `✕ ${errors}`;
  if (warningNode) warningNode.textContent = `⚠ ${warnings}`;
  if (badge) badge.textContent = String(errors + warnings);
}

function relativePath(uri) {
  return decodeURIComponent(String(uri?.path ?? '')).replace(/^\//, '');
}
function severityName(value) {
  if (value === monaco.MarkerSeverity.Error) return 'error';
  if (value === monaco.MarkerSeverity.Warning) return 'warning';
  if (value === monaco.MarkerSeverity.Info) return 'info';
  return 'hint';
}
function severityGlyph(value) {
  if (value === monaco.MarkerSeverity.Error) return '✕';
  if (value === monaco.MarkerSeverity.Warning) return '⚠';
  if (value === monaco.MarkerSeverity.Info) return 'ⓘ';
  return '·';
}
