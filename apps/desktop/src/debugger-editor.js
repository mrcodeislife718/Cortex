import * as monaco from 'monaco-editor';

const breakpoints = new Map();
const boundEditors = new WeakSet();
const collections = new WeakMap();

installStyles();
for (const editor of monaco.editor.getEditors?.() ?? []) bindEditor(editor);
monaco.editor.onDidCreateEditor?.((editor) => bindEditor(editor));
window.addEventListener('keydown', (event) => {
  if (event.key !== 'F9' || !event.isTrusted) return;
  const editor = activeEditor();
  const path = activePath();
  const line = editor?.getPosition()?.lineNumber;
  if (!path || !line) return;
  toggleVisual(path, line);
});
window.addEventListener('cortex-workspace-changed', () => {
  breakpoints.clear();
  refreshAll();
});

function bindEditor(editor) {
  if (!editor || boundEditors.has(editor)) return;
  boundEditors.add(editor);
  collections.set(editor, editor.createDecorationsCollection?.([]));
  editor.onDidChangeModel(() => refreshEditor(editor));
  editor.onMouseDown((event) => {
    const type = event.target?.type;
    if (type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && type !== monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) return;
    const line = event.target?.position?.lineNumber;
    const path = pathForModel(editor.getModel());
    if (!line || !path) return;
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
    toggleVisual(path, line);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', bubbles: true }));
  });
  refreshEditor(editor);
}

function toggleVisual(path, line) {
  const lines = breakpoints.get(path) ?? new Set();
  if (lines.has(line)) lines.delete(line); else lines.add(line);
  if (lines.size) breakpoints.set(path, lines); else breakpoints.delete(path);
  refreshAll();
}

function refreshAll() { for (const editor of monaco.editor.getEditors?.() ?? []) refreshEditor(editor); }
function refreshEditor(editor) {
  const collection = collections.get(editor);
  if (!collection) return;
  const path = pathForModel(editor.getModel());
  const lines = path ? [...(breakpoints.get(path) ?? [])] : [];
  collection.set(lines.map((line) => ({
    range: new monaco.Range(line, 1, line, 1),
    options: {
      isWholeLine: false,
      glyphMarginClassName: 'cortex-breakpoint-glyph',
      glyphMarginHoverMessage: { value: `Breakpoint · ${path}:${line}` },
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
  })));
}
function activeEditor() { return (monaco.editor.getEditors?.() ?? []).find((editor) => editor.hasTextFocus?.()) ?? (monaco.editor.getEditors?.() ?? [])[0] ?? null; }
function activePath() { return window.CortexWorkbench?.getState?.().activePath ?? null; }
function pathForModel(model) {
  if (!model || model.uri?.scheme !== 'cortex') return null;
  return decodeURIComponent(String(model.uri.path ?? '')).replace(/^\//, '');
}
function installStyles() {
  const style = document.createElement('style');
  style.textContent = `.cortex-breakpoint-glyph{background:radial-gradient(circle at center,#e5484d 0 45%,transparent 48%);cursor:pointer}`;
  document.head.append(style);
}
