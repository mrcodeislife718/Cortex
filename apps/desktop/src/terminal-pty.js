import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import '@xterm/xterm/css/xterm.css';

let terminal = null;
let fitAddon = null;
let sessionId = null;
let pump = null;
let resizeObserver = null;
let starting = null;

for (const button of document.querySelectorAll('[data-panel="terminal"]')) {
  button.addEventListener('click', () => queueMicrotask(() => void ensureTerminal()));
}
window.addEventListener('keydown', (event) => {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key === '`') {
    event.preventDefault();
    document.querySelector('[data-panel="terminal"]')?.click();
  }
});
window.addEventListener('beforeunload', () => void stopTerminal());

async function ensureTerminal() {
  if (!window.cortexWorkbench?.getWorkspace?.()) return;
  if (starting) return starting;
  if (terminal && sessionId) { terminal.focus(); fitTerminal(); return; }
  starting = startTerminal().finally(() => { starting = null; });
  return starting;
}

async function startTerminal() {
  const body = document.getElementById('panel-body');
  if (!body) return;
  body.replaceChildren();
  body.classList.add('pty-panel');
  const host = document.createElement('div');
  host.className = 'pty-host';
  body.append(host);
  fitAddon = new FitAddon();
  terminal = new Terminal({
    convertEol: false,
    cursorBlink: true,
    cursorStyle: 'block',
    fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
    fontSize: 12,
    lineHeight: 1.15,
    scrollback: 10_000,
    allowProposedApi: false,
    theme: { background: '#181818', foreground: '#d7d7d7', cursor: '#d8d1ff', selectionBackground: '#5a4b8066' },
  });
  terminal.loadAddon(fitAddon);
  terminal.open(host);
  fitTerminal();
  try {
    const started = await invoke('pty_start', { rows: terminal.rows, cols: terminal.cols });
    sessionId = started.sessionId;
    terminal.onData((data) => { if (sessionId) void invoke('pty_write', { sessionId, data }).catch(showTerminalError); });
    terminal.onResize(({ rows, cols }) => { if (sessionId) void invoke('pty_resize', { sessionId, rows, cols }).catch(() => {}); });
    resizeObserver = new ResizeObserver(() => fitTerminal());
    resizeObserver.observe(host);
    pump = setInterval(() => void drain(), 24);
    terminal.focus();
    setStatus('Terminal ready');
  } catch (error) {
    terminal.writeln(`\r\nCortex terminal failed: ${String(error)}`);
    setStatus('Terminal unavailable');
  }
}

async function drain() {
  if (!sessionId || !terminal) return;
  try {
    const output = await invoke('pty_read', { sessionId, maxBytes: 256 * 1024 });
    if (output) terminal.write(output);
  } catch (error) {
    terminal.writeln(`\r\n[Cortex terminal disconnected: ${String(error)}]`);
    await stopTerminal();
  }
}

async function stopTerminal() {
  clearInterval(pump); pump = null;
  resizeObserver?.disconnect(); resizeObserver = null;
  const id = sessionId; sessionId = null;
  if (id) await invoke('pty_stop', { sessionId: id }).catch(() => {});
  terminal?.dispose(); terminal = null; fitAddon = null;
}

function fitTerminal() {
  try { fitAddon?.fit(); } catch { /* panel may be transitioning */ }
}
function showTerminalError(error) { terminal?.writeln(`\r\n[Cortex terminal write failed: ${String(error)}]`); }
function setStatus(text) { const node=document.getElementById('cortex-status'); if(node)node.textContent=text; }
