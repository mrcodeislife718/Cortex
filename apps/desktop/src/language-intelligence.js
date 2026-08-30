import * as monaco from 'monaco-editor';
import { invoke } from '@tauri-apps/api/core';

const SERVER_BY_LANGUAGE = Object.freeze({
  python: { program: 'pyright-langserver', args: ['--stdio'] },
  rust: { program: 'rust-analyzer', args: [] },
  go: { program: 'gopls', args: [] },
  c: { program: 'clangd', args: [] },
  cpp: { program: 'clangd', args: [] },
  java: { program: 'jdtls', args: [] },
});

const sessions = new Map();
const unavailable = new Set();
const disposables = [];
let notificationTimer = null;

for (const language of Object.keys(SERVER_BY_LANGUAGE)) installProviders(language);
monaco.editor.onDidCreateModel((model) => void attachModel(model));
for (const model of monaco.editor.getModels()) void attachModel(model);
window.addEventListener('beforeunload', () => void shutdownAll());
window.addEventListener('cortex-workspace-changed', () => { unavailable.clear(); for (const model of monaco.editor.getModels()) void attachModel(model); });

function installProviders(language) {
  disposables.push(monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ['.', ':', '>', '/', '"', "'"],
    provideCompletionItems: async (model, position) => {
      const session = await ensureSession(language); if (!session) return { suggestions: [] };
      const response = await request(session, 'textDocument/completion', { textDocument: { uri: fileUriForModel(model) }, position: lspPosition(position) }, 10_000).catch(() => null);
      const result = response?.result; const items = Array.isArray(result) ? result : result?.items;
      if (!Array.isArray(items)) return { suggestions: [] };
      return { suggestions: items.slice(0, 500).map((item) => completionItem(model, position, item)) };
    },
  }));
  disposables.push(monaco.languages.registerHoverProvider(language, {
    provideHover: async (model, position) => {
      const session = await ensureSession(language); if (!session) return null;
      const response = await request(session, 'textDocument/hover', { textDocument: { uri: fileUriForModel(model) }, position: lspPosition(position) }, 8_000).catch(() => null);
      const hover = response?.result; if (!hover?.contents) return null;
      const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
      return { range: hover.range ? monacoRange(hover.range) : undefined, contents: contents.map(markdownContent) };
    },
  }));
  disposables.push(monaco.languages.registerDefinitionProvider(language, {
    provideDefinition: async (model, position) => {
      const session = await ensureSession(language); if (!session) return null;
      const response = await request(session, 'textDocument/definition', { textDocument: { uri: fileUriForModel(model) }, position: lspPosition(position) }, 10_000).catch(() => null);
      const locations = !response?.result ? [] : Array.isArray(response.result) ? response.result : [response.result];
      return locations.filter((item) => item?.uri && item?.range).map((item) => ({ uri: uriForLspLocation(item.uri), range: monacoRange(item.range) }));
    },
  }));
  disposables.push(monaco.languages.registerReferenceProvider(language, {
    provideReferences: async (model, position) => {
      const session = await ensureSession(language); if (!session) return [];
      const response = await request(session, 'textDocument/references', { textDocument: { uri: fileUriForModel(model) }, position: lspPosition(position), context: { includeDeclaration: true } }, 12_000).catch(() => null);
      return (Array.isArray(response?.result) ? response.result : []).filter((item) => item?.uri && item?.range).map((item) => ({ uri: uriForLspLocation(item.uri), range: monacoRange(item.range) }));
    },
  }));
}

async function attachModel(model) {
  const language = model.getLanguageId();
  if (!SERVER_BY_LANGUAGE[language]) return;
  const session = await ensureSession(language); if (!session || session.documents.has(model.uri.toString())) return;
  const uri = fileUriForModel(model);
  session.documents.add(model.uri.toString());
  await notify(session, 'textDocument/didOpen', { textDocument: { uri, languageId: language, version: model.getVersionId(), text: model.getValue() } }).catch(() => {});
  const changeDisposable = model.onDidChangeContent((event) => {
    const changes = session.syncKind === 2
      ? event.changes.map((change) => ({ range: monacoToLspRange(change.range), rangeLength: change.rangeLength, text: change.text }))
      : [{ text: model.getValue() }];
    void notify(session, 'textDocument/didChange', { textDocument: { uri, version: model.getVersionId() }, contentChanges: changes });
  });
  const disposeDisposable = model.onWillDispose(() => {
    changeDisposable.dispose(); disposeDisposable.dispose(); session.documents.delete(model.uri.toString());
    void notify(session, 'textDocument/didClose', { textDocument: { uri } });
    monaco.editor.setModelMarkers(model, `cortex-lsp-${language}`, []);
  });
}

async function ensureSession(language) {
  if (sessions.has(language)) return sessions.get(language);
  if (unavailable.has(language)) return null;
  const workspace = window.cortexWorkbench?.getWorkspace?.();
  if (!workspace) return null;
  const descriptor = SERVER_BY_LANGUAGE[language];
  try {
    const started = await invoke('protocol_start', { program: descriptor.program, args: descriptor.args });
    const session = { id: started.sessionId, language, documents: new Set(), syncKind: 1 };
    const rootUri = fileUri(workspace);
    const initialize = await request(session, 'initialize', {
      processId: null,
      clientInfo: { name: 'Cortex', version: '0.3.0' },
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: workspace.split(/[\\/]/).at(-1) ?? 'workspace' }],
      capabilities: {
        workspace: { workspaceFolders: true },
        textDocument: {
          synchronization: { dynamicRegistration: false, willSave: false, didSave: true },
          completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: true },
        },
      },
    }, 20_000);
    if (initialize?.error) throw new Error(initialize.error.message ?? 'language server initialization failed');
    session.syncKind = normalizeSyncKind(initialize?.result?.capabilities?.textDocumentSync);
    sessions.set(language, session);
    await notify(session, 'initialized', {});
    startNotificationPump();
    setLanguageStatus(`${descriptor.program} connected`);
    return session;
  } catch (error) {
    unavailable.add(language);
    setLanguageStatus(`${descriptor.program} unavailable`);
    return null;
  }
}

function startNotificationPump() {
  if (notificationTimer) return;
  notificationTimer = setInterval(() => {
    for (const session of sessions.values()) void drainNotifications(session);
  }, 250);
}

async function drainNotifications(session) {
  const notifications = await invoke('protocol_take_notifications', { sessionId: session.id, limit: 200 }).catch(() => []);
  for (const message of notifications) {
    if (message?.method === 'textDocument/publishDiagnostics') applyDiagnostics(session.language, message.params);
    else if (message?.cortexProtocolStderr) setLanguageStatus(String(message.cortexProtocolStderr).slice(0, 120));
  }
}

function applyDiagnostics(language, params) {
  const target = findModelForFileUri(params?.uri); if (!target) return;
  const markers = (params?.diagnostics ?? []).slice(0, 2_000).map((diagnostic) => ({
    startLineNumber: Number(diagnostic.range?.start?.line ?? 0) + 1,
    startColumn: Number(diagnostic.range?.start?.character ?? 0) + 1,
    endLineNumber: Number(diagnostic.range?.end?.line ?? diagnostic.range?.start?.line ?? 0) + 1,
    endColumn: Number(diagnostic.range?.end?.character ?? diagnostic.range?.start?.character ?? 0) + 1,
    message: String(diagnostic.message ?? 'Language server diagnostic'),
    severity: markerSeverity(diagnostic.severity),
    source: diagnostic.source ?? language,
    code: diagnostic.code == null ? undefined : String(diagnostic.code),
  }));
  monaco.editor.setModelMarkers(target, `cortex-lsp-${language}`, markers);
  const errors = monaco.editor.getModelMarkers({}).filter((marker) => marker.severity === monaco.MarkerSeverity.Error).length;
  const warnings = monaco.editor.getModelMarkers({}).filter((marker) => marker.severity === monaco.MarkerSeverity.Warning).length;
  const errorNode = document.getElementById('error-count'); const warningNode = document.getElementById('warning-count');
  if (errorNode) errorNode.textContent = `✕ ${errors}`; if (warningNode) warningNode.textContent = `⚠ ${warnings}`;
  const badge = document.querySelector('[data-panel="problems"] .badge'); if (badge) badge.textContent = String(errors + warnings);
}

async function request(session, method, params, timeoutMs) { return invoke('lsp_request', { sessionId: session.id, method, params, timeoutMs }); }
async function notify(session, method, params) { return invoke('lsp_notify', { sessionId: session.id, method, params }); }

async function shutdownAll() {
  clearInterval(notificationTimer); notificationTimer = null;
  for (const session of sessions.values()) {
    await request(session, 'shutdown', null, 2_000).catch(() => null);
    await notify(session, 'exit', null).catch(() => null);
    await invoke('protocol_stop', { sessionId: session.id }).catch(() => null);
  }
  sessions.clear();
}

function completionItem(model, position, item) {
  const edit = item.textEdit;
  const insertText = edit?.newText ?? item.insertText ?? (typeof item.label === 'string' ? item.label : item.label?.label) ?? '';
  return {
    label: item.label,
    detail: item.detail,
    documentation: item.documentation ? markdownContent(item.documentation) : undefined,
    sortText: item.sortText,
    filterText: item.filterText,
    insertText,
    insertTextRules: Number(item.insertTextFormat) === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    kind: completionKind(item.kind),
    range: edit?.range ? monacoRange(edit.range) : model.getWordUntilPosition(position)?.word ? new monaco.Range(position.lineNumber, model.getWordUntilPosition(position).startColumn, position.lineNumber, model.getWordUntilPosition(position).endColumn) : undefined,
  };
}
function completionKind(kind) { const values = monaco.languages.CompletionItemKind; const map = [values.Text,values.Method,values.Function,values.Constructor,values.Field,values.Variable,values.Class,values.Interface,values.Module,values.Property,values.Unit,values.Value,values.Enum,values.Keyword,values.Snippet,values.Color,values.File,values.Reference,values.Folder,values.EnumMember,values.Constant,values.Struct,values.Event,values.Operator,values.TypeParameter]; return map[Math.max(0, Number(kind ?? 1) - 1)] ?? values.Text; }
function markerSeverity(value) { return ({ 1: monaco.MarkerSeverity.Error, 2: monaco.MarkerSeverity.Warning, 3: monaco.MarkerSeverity.Info, 4: monaco.MarkerSeverity.Hint })[Number(value)] ?? monaco.MarkerSeverity.Info; }
function markdownContent(value) { if (typeof value === 'string') return { value }; if (value?.value != null) return { value: String(value.value), isTrusted: false }; if (value?.language && value?.value) return { value: `\`\`\`${value.language}\n${value.value}\n\`\`\`` }; return { value: String(value ?? '') }; }
function lspPosition(position) { return { line: position.lineNumber - 1, character: position.column - 1 }; }
function monacoRange(range) { return new monaco.Range(Number(range.start?.line ?? 0)+1,Number(range.start?.character ?? 0)+1,Number(range.end?.line ?? 0)+1,Number(range.end?.character ?? 0)+1); }
function monacoToLspRange(range) { return { start: { line: range.startLineNumber-1, character: range.startColumn-1 }, end: { line: range.endLineNumber-1, character: range.endColumn-1 } }; }
function normalizeSyncKind(sync) { if (typeof sync === 'number') return sync; if (typeof sync?.change === 'number') return sync.change; return 1; }
function fileUriForModel(model) { const path = String(model.uri.path ?? '').replace(/^\//,''); return fileUri(window.cortexWorkbench?.getWorkspace?.(), decodeURIComponent(path)); }
function fileUri(root, relative = '') { if (!root) return ''; let path = `${root}${relative ? `/${relative}` : ''}`.replace(/\\/g,'/'); if (/^[A-Za-z]:\//.test(path)) path = `/${path}`; return encodeURI(`file://${path}`).replace(/#/g,'%23'); }
function uriForLspLocation(uri) { const model = findModelForFileUri(uri); return model?.uri ?? monaco.Uri.parse(uri); }
function findModelForFileUri(uri) { const normalized = decodeURIComponent(String(uri ?? '')).replace(/^file:\/\//,'').replace(/^\/([A-Za-z]:\/)/,'$1').replace(/\\/g,'/'); return monaco.editor.getModels().find((model) => { const path = decodeURIComponent(String(model.uri.path ?? '')).replace(/^\//,'').replace(/\\/g,'/'); const root = String(window.cortexWorkbench?.getWorkspace?.() ?? '').replace(/\\/g,'/').replace(/\/$/,''); return normalized === `${root}/${path}`; }) ?? null; }
function setLanguageStatus(text) { const status = document.getElementById('cortex-status'); if (status) status.textContent = text; }
