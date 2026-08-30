import * as monaco from 'monaco-editor';
import { invoke } from '@tauri-apps/api/core';

const SAVE_INTERVAL_MS = 1500;
const MAX_RECOVERY_BUFFER_BYTES = 8 * 1024 * 1024;
let saving = false;
let lastSerialized = '';

function workspaceModelPath(model) {
  const uri = model?.uri?.toString?.() ?? '';
  const prefix = 'cortex://workspace/';
  return uri.startsWith(prefix) ? decodeURIComponent(uri.slice(prefix.length)) : null;
}

async function captureUnsavedBuffers(openEditors) {
  const open = new Set(openEditors);
  const buffers = [];
  let totalBytes = 0;
  for (const model of monaco.editor.getModels()) {
    const path = workspaceModelPath(model);
    if (!path || !open.has(path)) continue;
    const text = model.getValue();
    let diskText;
    try { diskText = await invoke('read_workspace_file', { relative: path }); }
    catch { diskText = null; }
    if (diskText === text) continue;
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > MAX_RECOVERY_BUFFER_BYTES || totalBytes + bytes > MAX_RECOVERY_BUFFER_BYTES) {
      console.warn('[Cortex:continuity] unsaved buffer exceeds recovery budget', path);
      continue;
    }
    totalBytes += bytes;
    buffers.push({ path, text, bytes });
  }
  return buffers;
}

async function snapshot() {
  const api = window.CortexWorkbench;
  if (!api) return null;
  const state = api.getState();
  const openEditors = state.openFiles || [];
  return {
    workspace: state.workspace || null,
    openEditors,
    unsavedBuffers: await captureUnsavedBuffers(openEditors),
    activeEditor: state.activePath || null,
    savedAt: new Date().toISOString(),
  };
}

async function persist() {
  if (saving) return;
  saving = true;
  try {
    const session = await snapshot();
    if (!session) return;
    const serialized = JSON.stringify(session);
    if (serialized === lastSerialized) return;
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
      try { await api.openFile(path); }
      catch (error) { console.warn('[Cortex:continuity] editor restore skipped', path, error); }
    }
    for (const buffer of session.unsavedBuffers || []) {
      if (!buffer?.path || typeof buffer.text !== 'string') continue;
      try {
        await api.openFile(buffer.path);
        const model = monaco.editor.getModels().find((candidate) => workspaceModelPath(candidate) === buffer.path);
        if (model && model.getValue() !== buffer.text) model.setValue(buffer.text);
      } catch (error) {
        console.warn('[Cortex:continuity] unsaved buffer restore skipped', buffer.path, error);
      }
    }
    if (session.activeEditor) {
      try { await api.openFile(session.activeEditor); } catch {}
    }
  } catch (error) {
    console.warn('[Cortex:continuity] no recoverable session', error);
  }
}

window.addEventListener('cortex-workspace-changed', () => void persist());
window.addEventListener('beforeunload', () => void persist());
setInterval(() => void persist(), SAVE_INTERVAL_MS);
queueMicrotask(() => void restore());
