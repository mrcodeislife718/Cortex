const api = () => window.CortexWorkbench ?? null;

const compatibility = Object.freeze({
  getWorkspace() { return api()?.getState?.().workspace ?? null; },
  getActivePath() { return api()?.getState?.().activePath ?? null; },
  getOpenFiles() { return [...(api()?.getState?.().openFiles ?? [])]; },
  getHealth() { return { ...(api()?.getState?.().health ?? {}) }; },
  openFile(path, options) { return api()?.openFile?.(path, options); },
  saveActive() { return api()?.saveActive?.(); },
  chooseWorkspace() { return api()?.chooseWorkspace?.(); },
  setWorkspace(path) { return api()?.setWorkspace?.(path); },
  renderSearch() { return api()?.renderSearch?.(); },
  renderGit() { return api()?.renderGit?.(); },
  renderTasks() { return api()?.renderTasks?.(); },
  ensureTerminal() { return api()?.ensureTerminal?.(); },
  showHealth() { return api()?.showHealth?.(); },
});

Object.defineProperty(window, 'cortexWorkbench', {
  configurable: false,
  enumerable: false,
  get() { return compatibility; },
});
