import { invoke } from '@tauri-apps/api/core';

const SAVE_INTERVAL_MS = 1500;
let saving = false;
let lastSerialized = '';

function snapshot() {
  const api = window.CortexWorkbench;
  if (!api) return null;
  const state = api.getState();
  return {
    workspace: state.workspace || null,
    openEditors: state.openFiles || [],
    unsavedBuffers: [],
    activeEditor: state.activePath || null,
    savedAt: new Date().toISOString(),
  };
}

async function persist() {
  if (saving) return;
  const session = snapshot();
  if (!session) return;
  const serialized = JSON.stringify(session);
  if (serialized === lastSerialized) return;
  saving = true;
  try {
    await invoke('save_workspace_session', { session });
    lastSerialized = serialized;
  } catch (error) {
    console.error('[Cortex:continuity] recovery save failed', error);
  } finally {
    saving = false;
  }
}

async function restore() {
  const api = window.CortexWorkbench;
  if (!api) return;
  try {
    const session = await invoke('restore_workspace_session');
    if (!session?.workspace) return;
    const current = api.getState();
    if (!current.workspace) await api.setWorkspace(session.workspace);
    for (const path of session.openEditors || []) {
      try { await api.openFile(path); } catch (error) { console.warn('[Cortex:continuity] editor restore skipped', path, error); }
    }
  } catch (error) {
    console.warn('[Cortex:continuity] no recoverable session', error);
  }
}

window.addEventListener('cortex-workspace-changed', () => void persist());
window.addEventListener('beforeunload', () => void persist());
setInterval(() => void persist(), SAVE_INTERVAL_MS);
queueMicrotask(() => void restore());
