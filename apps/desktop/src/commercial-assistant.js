import * as monaco from 'monaco-editor';
import { invoke } from '@tauri-apps/api/core';
import './commercial-assistant.css';

const apiUrl = String(import.meta.env.VITE_CORTEX_COMMERCIAL_API_URL ?? '').trim().replace(/\/$/, '');
const form = document.getElementById('assistant-form');

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
    context.push({ source: `current-editor:${attached.uri.toString()}`, text: text.length > 120_000 ? `${text.slice(0, 120_000)}\n[truncated by Cortex]` : text });
  }
  try {
    const git = await invoke('git_status');
    context.push({ source: 'git-status', text: String(git.stdout ?? '').slice(0, 30_000) });
  } catch { /* workspace may not be a Git repository */ }
  const sideTitle = document.getElementById('side-title')?.textContent;
  if (sideTitle) context.push({ source: 'workbench-state', text: `Active workbench surface: ${sideTitle}` });
  return context;
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
