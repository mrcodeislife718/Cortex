import { invoke } from '@tauri-apps/api/core';

const breakpoints = new Map();
let debugSession = null;
let pump = null;
let rendering = false;

const observer = new MutationObserver(() => scheduleInject());
observer.observe(document.getElementById('side-content'), { childList: true, subtree: true });
window.addEventListener('keydown', (event) => {
  if (event.key === 'F5') { event.preventDefault(); void runFirstConfiguration(); }
  if (event.key === 'F9') { event.preventDefault(); addBreakpoint(); }
  if (event.key === 'F10' && debugSession) { event.preventDefault(); void dapControl('next'); }
  if (event.key === 'F11' && debugSession) { event.preventDefault(); void dapControl(event.shiftKey ? 'stepOut' : 'stepIn'); }
});
window.addEventListener('beforeunload', () => void stopDebug());
scheduleInject();

function scheduleInject() {
  if (rendering) return;
  queueMicrotask(() => void injectDebugControls());
}

async function injectDebugControls() {
  if (document.getElementById('side-title')?.textContent !== 'RUN AND DEBUG') return;
  const side = document.getElementById('side-content');
  if (!side || side.querySelector('.debug-controls')) return;
  rendering = true;
  try {
    const configs = await loadConfigurations();
    const section = document.createElement('section');
    section.className = 'debug-controls';
    const options = configs.length
      ? configs.map((config, index) => `<option value="${index}">${escapeHtml(config.name ?? `${config.type ?? 'DAP'} configuration`)}</option>`).join('')
      : '<option value="">No launch configurations</option>';
    section.innerHTML = `<div class="debug-launch-row"><select id="debug-configuration">${options}</select><button id="debug-start" title="Start Debugging (F5)">▷</button></div><div class="debug-toolbar"><button data-debug="continue" title="Continue">▶</button><button data-debug="pause" title="Pause">Ⅱ</button><button data-debug="next" title="Step Over (F10)">↷</button><button data-debug="stepIn" title="Step Into (F11)">↓</button><button data-debug="stepOut" title="Step Out (Shift+F11)">↑</button><button id="debug-breakpoint" title="Toggle breakpoint at cursor (F9)">●</button><button data-debug="disconnect" title="Stop">■</button></div><div id="debug-state" class="debug-state">${debugSession ? 'Debug session active' : configs.length ? 'Ready to debug' : 'Add .vscode/launch.json or a Cortex DAP adapter.'}</div>`;
    side.prepend(section);
    section.querySelector('#debug-start').onclick = () => {
      const value = section.querySelector('#debug-configuration').value;
      if (value !== '') void startDebug(configs[Number(value)]);
    };
    section.querySelector('#debug-breakpoint').onclick = addBreakpoint;
    for (const button of section.querySelectorAll('[data-debug]')) button.onclick = () => void dapControl(button.dataset.debug);
  } finally { rendering = false; }
}

async function runFirstConfiguration() {
  const configs = await loadConfigurations();
  if (!configs.length) { showDebugOutput('No debug configuration found. Add .vscode/launch.json or configure a Cortex DAP adapter.'); return; }
  await startDebug(configs[0]);
}

async function loadConfigurations() {
  if (!window.cortexWorkbench?.getWorkspace?.()) return [];
  try {
    const text = await invoke('read_workspace_file', { relative: '.vscode/launch.json' });
    const parsed = JSON.parse(stripJsonComments(text));
    return Array.isArray(parsed.configurations) ? parsed.configurations.filter((config) => config && typeof config === 'object') : [];
  } catch { return []; }
}

async function startDebug(config) {
  if (!config) return;
  await stopDebug();
  const adapter = adapterFor(config);
  if (!adapter) { showDebugOutput(`No DAP adapter mapping for type “${config.type ?? 'unknown'}”. Add cortexAdapter: { "program": "adapter", "args": [] } to the launch configuration.`); return; }
  setDebugState(`Starting ${adapter.program}…`);
  try {
    const started = await invoke('protocol_start', { program: adapter.program, args: adapter.args });
    debugSession = { id: started.sessionId, config, adapter, threadId: null };
    const initialized = await invoke('dap_request', { sessionId: debugSession.id, command: 'initialize', arguments: { clientID: 'cortex', clientName: 'Cortex', adapterID: String(config.type ?? 'cortex'), pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true, supportsVariableType: true, supportsVariablePaging: true, supportsRunInTerminalRequest: false }, timeoutMs: 10_000 });
    if (initialized?.success === false) throw new Error(initialized.message ?? 'debug adapter initialization failed');
    pump = setInterval(() => void drainDebugEvents(), 100);
    const request = config.request === 'attach' ? 'attach' : 'launch';
    const launchArguments = sanitizeLaunchConfig(config);
    const launchPromise = invoke('dap_request', { sessionId: debugSession.id, command: request, arguments: launchArguments, timeoutMs: 60_000 });
    await waitForInitialized(5_000);
    await sendAllBreakpoints();
    await invoke('dap_request', { sessionId: debugSession.id, command: 'configurationDone', arguments: {}, timeoutMs: 10_000 }).catch(() => null);
    const launched = await launchPromise;
    if (launched?.success === false) throw new Error(launched.message ?? `${request} failed`);
    setDebugState(`Debugging ${config.name ?? config.type ?? 'configuration'}`);
  } catch (error) {
    showDebugOutput(`Debug start failed: ${error}`);
    await stopDebug();
  }
}

async function waitForInitialized(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const events = await takeEvents();
    for (const event of events) {
      if (event?.type === 'event' && event.event === 'initialized') return true;
      handleEvent(event);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function dapControl(command) {
  if (!debugSession) return;
  if (command === 'disconnect') { await stopDebug(); return; }
  const threadId = debugSession.threadId;
  const argumentsByCommand = {
    continue: { threadId }, pause: { threadId }, next: { threadId }, stepIn: { threadId }, stepOut: { threadId },
  };
  try {
    const response = await invoke('dap_request', { sessionId: debugSession.id, command, arguments: argumentsByCommand[command] ?? {}, timeoutMs: 10_000 });
    if (response?.success === false) throw new Error(response.message ?? `${command} failed`);
  } catch (error) { showDebugOutput(`Debug ${command} failed: ${error}`); }
}

async function stopDebug() {
  clearInterval(pump); pump = null;
  if (!debugSession) return;
  const id = debugSession.id; debugSession = null;
  await invoke('dap_request', { sessionId: id, command: 'disconnect', arguments: { restart: false, terminateDebuggee: true }, timeoutMs: 3_000 }).catch(() => null);
  await invoke('protocol_stop', { sessionId: id }).catch(() => null);
  setDebugState('Debug session stopped');
}

function addBreakpoint() {
  const path = window.cortexWorkbench?.getActivePath?.();
  if (!path) { showDebugOutput('Open a source file before adding a breakpoint.'); return; }
  const cursor = document.getElementById('cursor-position')?.textContent?.match(/Ln\s+(\d+)/i);
  const line = Number(cursor?.[1]);
  if (!Number.isInteger(line) || line <= 0) { showDebugOutput('Place the editor cursor on the line where you want a breakpoint.'); return; }
  const lines = breakpoints.get(path) ?? new Set();
  if (lines.has(line)) lines.delete(line); else lines.add(line);
  if (lines.size) breakpoints.set(path, lines); else breakpoints.delete(path);
  setDebugState(`${[...breakpoints.values()].reduce((sum, values) => sum + values.size, 0)} breakpoint(s) · ${path}:${line}`);
  if (debugSession) void sendBreakpoints(path);
}

async function sendAllBreakpoints() { for (const path of breakpoints.keys()) await sendBreakpoints(path); }
async function sendBreakpoints(path) {
  if (!debugSession) return;
  const workspace = window.cortexWorkbench?.getWorkspace?.(); if (!workspace) return;
  const sourcePath = joinPath(workspace, path);
  const lines = [...(breakpoints.get(path) ?? [])].sort((a,b)=>a-b);
  await invoke('dap_request', { sessionId: debugSession.id, command: 'setBreakpoints', arguments: { source: { name: path.split('/').at(-1), path: sourcePath }, breakpoints: lines.map((line) => ({ line })), sourceModified: false }, timeoutMs: 10_000 }).catch((error) => showDebugOutput(`Breakpoint update failed: ${error}`));
}

async function drainDebugEvents() { for (const event of await takeEvents()) handleEvent(event); }
async function takeEvents() { if (!debugSession) return []; return invoke('protocol_take_notifications', { sessionId: debugSession.id, limit: 200 }).catch(() => []); }

function handleEvent(event) {
  if (!event || !debugSession) return;
  if (event.cortexProtocolStderr) { showDebugOutput(String(event.cortexProtocolStderr)); return; }
  if (event.cortexProtocolError) { showDebugOutput(`DAP protocol error: ${event.cortexProtocolError}`); return; }
  if (event.type !== 'event') return;
  if (event.event === 'output') { const text = event.body?.output; if (text) appendDebugOutput(text); }
  if (event.event === 'stopped') {
    debugSession.threadId = Number(event.body?.threadId ?? 0) || null;
    setDebugState(`Paused${event.body?.reason ? ` · ${event.body.reason}` : ''}`);
    void renderStack();
  }
  if (event.event === 'continued') setDebugState('Running');
  if (event.event === 'terminated' || event.event === 'exited') void stopDebug();
}

async function renderStack() {
  if (!debugSession?.threadId) return;
  try {
    const stack = await invoke('dap_request', { sessionId: debugSession.id, command: 'stackTrace', arguments: { threadId: debugSession.threadId, startFrame: 0, levels: 50 }, timeoutMs: 10_000 });
    const frames = stack?.body?.stackFrames ?? [];
    const text = frames.map((frame, index) => `${index === 0 ? '▶' : ' '} ${frame.name}  ${frame.source?.path ?? ''}:${frame.line ?? ''}`).join('\n');
    showDebugOutput(text || 'Paused with no stack frames.');
  } catch (error) { showDebugOutput(`Stack trace unavailable: ${error}`); }
}

function adapterFor(config) {
  if (config.cortexAdapter?.program) return { program: String(config.cortexAdapter.program), args: Array.isArray(config.cortexAdapter.args) ? config.cortexAdapter.args.map(String) : [] };
  const type = String(config.type ?? '').toLowerCase();
  if (type === 'python' || type === 'debugpy') return { program: 'python', args: ['-m', 'debugpy.adapter'] };
  if (type === 'lldb' || type === 'rust' || type === 'cpp' || type === 'c') return { program: 'lldb-dap', args: [] };
  return null;
}
function sanitizeLaunchConfig(config) { const output = structuredClone(config); for (const key of ['name','type','request','cortexAdapter']) delete output[key]; return output; }
function stripJsonComments(text) { return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/,\s*([}\]])/g, '$1'); }
function joinPath(root, relative) { const separator = String(root).includes('\\') ? '\\' : '/'; return `${String(root).replace(/[\\/]$/,'')}${separator}${String(relative).replace(/[\\/]/g,separator)}`; }
function setDebugState(text) { const node=document.getElementById('debug-state'); if(node)node.textContent=text; const status=document.getElementById('cortex-status'); if(status)status.textContent=text; }
function showDebugOutput(text) { const body=document.getElementById('panel-body'); if(body)body.textContent=String(text ?? ''); document.querySelectorAll('[data-panel]').forEach(button=>button.classList.toggle('active',button.dataset.panel==='debug')); }
function appendDebugOutput(text) { const body=document.getElementById('panel-body'); if(body)body.textContent += String(text ?? ''); document.querySelectorAll('[data-panel]').forEach(button=>button.classList.toggle('active',button.dataset.panel==='debug')); }
function escapeHtml(value){return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
