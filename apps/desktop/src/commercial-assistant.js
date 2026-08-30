import * as monaco from 'monaco-editor';
import { invoke } from '@tauri-apps/api/core';
import './commercial-assistant.css';

const apiUrl = String(import.meta.env.VITE_CORTEX_COMMERCIAL_API_URL ?? '').trim().replace(/\/$/, '');
const form = document.getElementById('assistant-form');
const SAFE_CONTEXT_FILES = Object.freeze([
  'README.md', 'README', 'package.json', 'tsconfig.json', 'jsconfig.json',
  'Cargo.toml', 'pyproject.toml', 'requirements.txt', 'go.mod', 'pom.xml',
  'build.gradle', 'build.gradle.kts', 'Dockerfile', 'compose.yml', 'compose.yaml',
]);
const SECRET_NAME = /(^|\/)(\.env(?:\.|$)|\.npmrc$|\.pypirc$|credentials?|secrets?|.*\.pem$|.*\.key$|id_rsa$|id_ed25519$)/i;

if (form) form.addEventListener('submit', handleAssistant, { capture: true });

async function handleAssistant(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  const input = document.getElementById('assistant-input');
  const goal = input?.value.trim();
  if (!goal) return;
  input.value = '';
  const body = document.querySelector('.assistant-body');
  const contextLabel = document.getElementById('context-label');
  renderMessage(body, 'user', goal);

  if (!apiUrl) {
    renderMessage(body, 'error', 'Engineering intelligence is not configured in this Cortex build. Editing, terminal, Git, language intelligence, debugging, and local workspace features remain available; Cortex will not pretend an AI request was completed when no model backend is configured.');
    contextLabel.textContent = 'Engineering intelligence unavailable';
    return;
  }

  contextLabel.textContent = 'Gathering Cortex context…';
  try {
    const context = await collectContext();
    contextLabel.textContent = 'Engineering…';
    const response = await invoke('commercial_assistant', { apiUrl, input: goal, context });
    if (response.status === 'approval-required') {
      renderMessage(body, 'assistant', `This objective reaches a privileged or production boundary. Cortex classified it as ${response.route?.depth ?? 'engineering'} work and will not execute the side effect without explicit approval. You can still ask me to explain the plan, inspect the risk, or prepare the change.`);
    } else {
      renderMessage(body, 'assistant', String(response.result ?? 'Cortex completed the request.'), response.provider);
    }
    contextLabel.textContent = response.provider ? `${response.provider} · Cortex context` : 'Cortex context automatic';
  } catch (error) {
    renderMessage(body, 'error', readableError(error));
    contextLabel.textContent = 'Cortex Ready';
  }
}

async function collectContext() {
  const context = [];
  const attached = monaco.editor.getModels().find((model) => model.isAttachedToEditor?.()) ?? monaco.editor.getModels().at(-1);
  if (attached) {
    const text = attached.getValue();
    context.push({ source: `current-editor:${attached.uri.toString()}`, text: bounded(text, 120_000) });
  }

  try {
    const git = await invoke('git_status');
    context.push({ source: 'git-status', text: bounded(String(git.stdout ?? ''), 30_000) });
  } catch { /* workspace may not be a Git repository */ }

  if (window.cortexWorkbench?.getWorkspace?.()) {
    const tree = await collectRepositoryOutline().catch(() => []);
    if (tree.length) context.push({ source: 'repository-outline', text: tree.join('\n') });
    for (const relative of SAFE_CONTEXT_FILES) {
      if (SECRET_NAME.test(relative)) continue;
      try {
        const text = await invoke('read_workspace_file', { relative });
        context.push({ source: `project-file:${relative}`, text: bounded(text, relative.startsWith('README') ? 30_000 : 20_000) });
      } catch { /* optional project file */ }
    }
  }

  const markers = monaco.editor.getModelMarkers({}).slice(0, 250);
  if (markers.length) {
    context.push({ source: 'editor-diagnostics', text: JSON.stringify(markers.map((marker) => ({
      resource: String(marker.resource), severity: marker.severity, message: marker.message,
      line: marker.startLineNumber, column: marker.startColumn, source: marker.source ?? null,
    }))) });
  }

  const sideTitle = document.getElementById('side-title')?.textContent;
  if (sideTitle) context.push({ source: 'workbench-state', text: `Active workbench surface: ${sideTitle}` });
  return enforceContextBudget(context, 220_000);
}

async function collectRepositoryOutline() {
  const output = [];
  const queue = [{ relative: '', depth: 0 }];
  while (queue.length && output.length < 2_000) {
    const current = queue.shift();
    const entries = await invoke('list_workspace', { relative: current.relative || null });
    for (const entry of entries) {
      if (output.length >= 2_000) break;
      const relative = String(entry.relative_path ?? '').replace(/\\/g, '/');
      if (!relative || SECRET_NAME.test(relative)) continue;
      output.push(`${entry.is_directory ? 'dir ' : 'file'} ${relative}${entry.bytes == null ? '' : ` (${entry.bytes}b)`}`);
      if (entry.is_directory && current.depth < 2) queue.push({ relative, depth: current.depth + 1 });
    }
  }
  return output;
}

function enforceContextBudget(parts, maxCharacters) {
  const output = [];
  let remaining = maxCharacters;
  for (const part of parts) {
    if (remaining <= 0) break;
    const text = bounded(String(part.text ?? ''), remaining);
    if (!text) continue;
    output.push({ source: String(part.source ?? 'workspace-data').slice(0, 80), text });
    remaining -= text.length;
  }
  return output;
}

function bounded(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, Math.max(0, max - 24))}\n[truncated by Cortex]` : value;
}

function renderMessage(container, role, text, provider = null) {
  if (!container) return;
  const message = document.createElement('article');
  message.className = `assistant-message assistant-${role}`;
  const label = document.createElement('div');
  label.className = 'assistant-message-label';
  label.textContent = role === 'user' ? 'YOU' : role === 'error' ? 'CORTEX ERROR' : provider ? `CORTEX · ${String(provider).toUpperCase()}` : 'CORTEX';
  const content = document.createElement('pre');
  content.className = 'assistant-message-content';
  content.textContent = text;
  message.append(label, content);
  if (container.querySelector('.assistant-empty')) container.replaceChildren();
  container.append(message);
  container.scrollTop = container.scrollHeight;
}

function readableError(error) {
  const message = String(error?.message ?? error ?? 'Unknown assistant failure');
  if (/session expired|401/i.test(message)) return 'Your Cortex session expired. Generate a new activation code from your Cortex account.';
  if (/402|entitlement/i.test(message)) return 'Your current Cortex plan does not include hosted engineering intelligence.';
  if (/503|provider/i.test(message)) return 'No hosted model provider is currently available. Cortex editing and local IDE features remain available.';
  return message;
}
