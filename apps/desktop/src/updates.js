import { invoke } from '@tauri-apps/api/core';

window.addEventListener('cortex-check-updates', () => void checkForUpdates());

async function checkForUpdates() {
  showStatus('Checking signed Cortex release channel…');
  try {
    const update = await invoke('check_for_updates');
    if (!update) {
      showMessage('CORTEX UPDATE', 'Cortex is up to date.');
      showStatus('Cortex Ready');
      return;
    }
    const notes = update.notes ? `\n\n${update.notes}` : '';
    const accepted = globalThis.confirm(`Cortex ${update.version} is available (current ${update.currentVersion}).${notes}\n\nInstall the verified update now?`);
    if (!accepted) {
      showStatus(`Update ${update.version} ready`);
      return;
    }
    showStatus(`Installing Cortex ${update.version}…`);
    await invoke('install_pending_update');
    showMessage('CORTEX UPDATE', `Cortex ${update.version} was verified and installed. Restart Cortex to finish applying the update.`);
    showStatus('Restart required');
  } catch (error) {
    showMessage('CORTEX UPDATE ERROR', String(error?.message ?? error));
    showStatus('Cortex Ready');
  }
}

function showStatus(text) {
  const status = document.getElementById('cortex-status');
  if (status) status.textContent = text;
}

function showMessage(label, text) {
  const body = document.querySelector('.assistant-body');
  if (!body) return;
  const card = document.createElement('article');
  card.className = 'assistant-message';
  const title = document.createElement('div');
  title.className = 'assistant-message-label';
  title.textContent = label;
  const content = document.createElement('pre');
  content.className = 'assistant-message-content';
  content.textContent = text;
  card.append(title, content);
  if (body.querySelector('.assistant-empty')) body.replaceChildren();
  body.append(card);
  body.scrollTop = body.scrollHeight;
}
