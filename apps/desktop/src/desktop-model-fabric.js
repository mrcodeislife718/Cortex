import * as monaco from 'monaco-editor';
import { invoke } from '@tauri-apps/api/core';

const CONFIG_KEY = 'cortex.model-fabric.v1';
const DEFAULT = Object.freeze({ mode: 'hosted', profile: 'default', protocol: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'qwen3-coder' });
let config = loadConfig();
let injecting = false;

const sideObserver = new MutationObserver(() => scheduleSettingsInjection());
const side = document.getElementById('side-content');
if (side) sideObserver.observe(side, { childList: true, subtree: true });
scheduleSettingsInjection();

document.getElementById('assistant-form')?.addEventListener('submit', async (event) => {
  if (config.mode !== 'custom') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const inputNode = document.getElementById('assistant-input');
  const input = inputNode?.value?.trim();
  if (!input) return;
  inputNode.value = '';
  await runCustomModel(input);
}, { capture: true });

async function runCustomModel(input) {
  const body = document.getElementById('assistant-body');
  if (!body) return;
  body.innerHTML = `<div style="padding:12px"><strong>You</strong><p>${escapeHtml(input)}</p><p class="muted">Cortex is assembling bounded local engineering context…</p></div>`;
  try {
    const context = await collectContext();
    const result = await invoke('model_generate', { request: { profile: config.profile, endpoint: config.endpoint, protocol: config.protocol, model: config.model, input, context, maxOutputTokens: 4096, temperature: 0.2 } });
    body.innerHTML += `<div style="padding:12px"><strong>Cortex · ${escapeHtml(result.model)}</strong><pre style="white-space:pre-wrap;font:inherit">${escapeHtml(result.text)}</pre><small>${escapeHtml(result.protocol)}${result.inputTokens != null ? ` · ${result.inputTokens} in / ${result.outputTokens ?? '?'} out` : ''}</small></div>`;
    setStatus(`Model ${result.model} ready`);
  } catch (error) {
    body.innerHTML += `<div style="padding:12px"><strong>Cortex model error</strong><p>${escapeHtml(String(error))}</p></div>`;
    setStatus('Model unavailable');
  }
}

async function collectContext() {
  const state = window.CortexWorkbench?.getState?.() ?? {};
  const context = [];
  if (state.workspace) context.push({ source: 'workspace', text: state.workspace.split(/[\\/]/).at(-1) ?? 'workspace' });
  if (state.activePath) {
    const target = monaco.editor.getModels().find((model) => decodeURIComponent(String(model.uri.path ?? '')).replace(/^\//, '') === state.activePath);
    if (target) context.push({ source: `active-editor:${state.activePath}`, text: target.getValue().slice(0, 60_000) });
  }
  try {
    if (state.workspace) {
      const git = await invoke('git_status');
      context.push({ source: 'git-status', text: `${git.stdout ?? ''}\n${git.stderr ?? ''}`.slice(0, 12_000) });
      const entries = await invoke('list_workspace', { relative: null });
      context.push({ source: 'repository-outline', text: entries.slice(0, 500).map((entry) => `${entry.isDirectory ? 'dir' : 'file'} ${entry.relativePath}`).join('\n') });
    }
  } catch {}
  const markers = monaco.editor.getModelMarkers({}).slice(0, 500).map((marker) => `${marker.resource.path}:${marker.startLineNumber}:${marker.startColumn} ${marker.message}`);
  if (markers.length) context.push({ source: 'diagnostics', text: markers.join('\n') });
  return context;
}

function scheduleSettingsInjection() {
  if (injecting) return;
  queueMicrotask(() => void injectSettings());
}

async function injectSettings() {
  if (document.getElementById('side-title')?.textContent !== 'SETTINGS') return;
  const host = document.getElementById('side-content');
  if (!host || host.querySelector('.model-fabric-settings')) return;
  injecting = true;
  try {
    const section = document.createElement('section');
    section.className = 'model-fabric-settings';
    section.style.cssText = 'padding:12px;border-top:1px solid #333;display:grid;gap:8px';
    section.innerHTML = `
      <strong>Model Fabric</strong>
      <label>Mode <select id="model-mode"><option value="hosted">Cortex Hosted</option><option value="custom">Local / Custom</option></select></label>
      <label>Protocol <select id="model-protocol"><option value="ollama">Ollama</option><option value="openai-compatible">OpenAI-compatible</option></select></label>
      <label>Endpoint <input id="model-endpoint" value="${escapeAttribute(config.endpoint)}"></label>
      <label>Model <input id="model-name" value="${escapeAttribute(config.model)}"></label>
      <label>Profile <input id="model-profile" value="${escapeAttribute(config.profile)}"></label>
      <label>API key <input id="model-key" type="password" autocomplete="off" placeholder="Stored in OS keyring"></label>
      <div style="display:flex;gap:6px"><button id="model-save">Save</button><button id="model-test">Test</button><button id="model-clear-key">Clear Key</button></div>
      <small id="model-status" class="muted"></small>`;
    host.append(section);
    section.querySelector('#model-mode').value = config.mode;
    section.querySelector('#model-protocol').value = config.protocol;
    section.querySelector('#model-save').onclick = () => void saveModelSettings(section);
    section.querySelector('#model-test').onclick = () => void testModel(section);
    section.querySelector('#model-clear-key').onclick = () => void clearKey(section);
    const hasKey = await invoke('model_has_credential', { profile: config.profile }).catch(() => false);
    section.querySelector('#model-status').textContent = hasKey ? 'Credential stored securely.' : 'No stored credential; local endpoints may not need one.';
  } finally { injecting = false; }
}

async function saveModelSettings(section) {
  const next = readSection(section);
  if (!next.profile) return setModelStatus(section, 'Profile is required.');
  const key = section.querySelector('#model-key').value;
  if (key) await invoke('model_store_credential', { profile: next.profile, apiKey: key });
  config = next;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  section.querySelector('#model-key').value = '';
  setModelStatus(section, `Saved · ${config.mode === 'custom' ? `${config.protocol} ${config.model}` : 'Cortex Hosted'}`);
}

async function testModel(section) {
  const next = readSection(section);
  setModelStatus(section, 'Testing…');
  try {
    const probe = await invoke('model_probe', { endpoint: next.endpoint, protocol: next.protocol, profile: next.profile });
    setModelStatus(section, `${probe.ok ? 'Connected' : 'Rejected'} · ${probe.detail}`);
  } catch (error) { setModelStatus(section, String(error)); }
}

async function clearKey(section) {
  const profile = section.querySelector('#model-profile').value.trim();
  try { await invoke('model_clear_credential', { profile }); setModelStatus(section, 'Credential removed.'); }
  catch (error) { setModelStatus(section, String(error)); }
}

function readSection(section) {
  return {
    mode: section.querySelector('#model-mode').value,
    protocol: section.querySelector('#model-protocol').value,
    endpoint: section.querySelector('#model-endpoint').value.trim(),
    model: section.querySelector('#model-name').value.trim(),
    profile: section.querySelector('#model-profile').value.trim(),
  };
}
function loadConfig() { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') }; } catch { return { ...DEFAULT }; } }
function setModelStatus(section, text) { const node = section.querySelector('#model-status'); if (node) node.textContent = text; }
function setStatus(text) { const node = document.getElementById('cortex-status'); if (node) node.textContent = text; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch])); }
function escapeAttribute(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }
