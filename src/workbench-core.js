import crypto from 'node:crypto';

const clone = (value) => globalThis.structuredClone(value);

export const WorkbenchAreas = Object.freeze({
  ACTIVITY: 'activity', EXPLORER: 'explorer', EDITOR: 'editor', PANEL: 'panel', STATUS: 'status', ASSISTANT: 'assistant',
});

export class CommandRegistry {
  constructor() { this.commands = new Map(); }
  register(id, handler, { title = id, category = null, when = () => true } = {}) {
    if (!id || typeof handler !== 'function') throw new Error('command id and handler are required');
    if (this.commands.has(id)) throw new Error(`duplicate command: ${id}`);
    this.commands.set(id, { id, title, category, handler, when });
    return () => this.commands.delete(id);
  }
  list(context = {}) { return [...this.commands.values()].filter((command) => command.when(context)).map(({ handler, when, ...command }) => clone(command)); }
  async execute(id, args, context = {}) {
    const command = this.commands.get(id);
    if (!command) throw new Error(`unknown command: ${id}`);
    if (!command.when(context)) throw new Error(`command unavailable: ${id}`);
    return command.handler(args, context);
  }
}

export class SettingsRegistry {
  constructor() { this.schema = new Map(); this.layers = { default: {}, user: {}, workspace: {}, folder: {} }; }
  define(key, { type, defaultValue, enum: allowed = null }) {
    if (!key || !['string', 'number', 'boolean', 'object', 'array'].includes(type)) throw new Error('invalid setting definition');
    this.schema.set(key, { type, defaultValue: clone(defaultValue), enum: allowed ? [...allowed] : null });
    this.layers.default[key] = clone(defaultValue);
    return this;
  }
  set(scope, key, value) {
    if (!['user', 'workspace', 'folder'].includes(scope)) throw new Error('invalid setting scope');
    const definition = this.schema.get(key);
    if (!definition) throw new Error(`unknown setting: ${key}`);
    if (!matchesType(value, definition.type)) throw new Error(`invalid setting type for ${key}`);
    if (definition.enum && !definition.enum.includes(value)) throw new Error(`invalid setting value for ${key}`);
    this.layers[scope][key] = clone(value);
    return value;
  }
  get(key, { folder = true, workspace = true, user = true } = {}) {
    if (!this.schema.has(key)) throw new Error(`unknown setting: ${key}`);
    if (folder && key in this.layers.folder) return clone(this.layers.folder[key]);
    if (workspace && key in this.layers.workspace) return clone(this.layers.workspace[key]);
    if (user && key in this.layers.user) return clone(this.layers.user[key]);
    return clone(this.layers.default[key]);
  }
}

export class KeybindingRegistry {
  constructor() { this.bindings = []; }
  bind({ key, command, when = 'always', source = 'user' }) {
    if (!key || !command) throw new Error('keybinding requires key and command');
    const conflict = this.bindings.find((entry) => entry.key === key && entry.when === when);
    const binding = { id: crypto.randomUUID(), key, command, when, source, conflictsWith: conflict?.id ?? null };
    this.bindings.push(binding);
    return clone(binding);
  }
  resolve(key, context = {}) {
    const candidates = this.bindings.filter((binding) => binding.key === key && matchesWhen(binding.when, context));
    return clone(candidates.at(-1) ?? null);
  }
  conflicts() { return clone(this.bindings.filter((binding) => binding.conflictsWith)); }
}

export class EditorGroupManager {
  constructor() { this.groups = [{ id: 'group-1', editors: [], active: null }]; this.activeGroup = 'group-1'; }
  open(uri, { preview = false, groupId = this.activeGroup } = {}) {
    const group = this.#group(groupId);
    const existing = group.editors.find((editor) => editor.uri === uri);
    if (existing) { group.active = existing.id; return clone(existing); }
    if (preview) group.editors = group.editors.filter((editor) => !editor.preview);
    const editor = { id: crypto.randomUUID(), uri, preview, dirty: false, pinned: !preview };
    group.editors.push(editor); group.active = editor.id; this.activeGroup = groupId;
    return clone(editor);
  }
  split(direction = 'right') {
    if (!['right', 'left', 'up', 'down'].includes(direction)) throw new Error('invalid split direction');
    const group = { id: `group-${this.groups.length + 1}`, editors: [], active: null, direction };
    this.groups.push(group); this.activeGroup = group.id; return clone(group);
  }
  markDirty(uri, dirty = true) {
    for (const group of this.groups) {
      const editor = group.editors.find((candidate) => candidate.uri === uri);
      if (editor) editor.dirty = dirty;
    }
  }
  close(uri, { force = false } = {}) {
    for (const group of this.groups) {
      const index = group.editors.findIndex((editor) => editor.uri === uri);
      if (index < 0) continue;
      if (group.editors[index].dirty && !force) throw new Error(`editor has unsaved changes: ${uri}`);
      const [removed] = group.editors.splice(index, 1);
      if (group.active === removed.id) group.active = group.editors.at(-1)?.id ?? null;
      return true;
    }
    return false;
  }
  snapshot() { return clone({ groups: this.groups, activeGroup: this.activeGroup }); }
  #group(id) { const group = this.groups.find((candidate) => candidate.id === id); if (!group) throw new Error(`unknown editor group: ${id}`); return group; }
}

export class ProblemsModel {
  constructor() { this.items = new Map(); }
  replace(owner, diagnostics = []) { this.items.set(owner, clone(diagnostics)); }
  all() { return clone([...this.items.entries()].flatMap(([owner, diagnostics]) => diagnostics.map((diagnostic) => ({ owner, ...diagnostic })))); }
  counts() { const out = { error: 0, warning: 0, info: 0 }; for (const item of this.all()) out[item.severity] = (out[item.severity] ?? 0) + 1; return out; }
}

export class TestExplorerModel {
  constructor() { this.tests = new Map(); }
  upsert(test) { if (!test?.id || !test.label) throw new Error('test requires id and label'); this.tests.set(test.id, { status: 'unknown', durationMs: null, ...clone(test) }); return this.get(test.id); }
  result(id, { status, durationMs = null, message = null }) { if (!['passed', 'failed', 'skipped', 'running'].includes(status)) throw new Error('invalid test status'); const test = this.#get(id); Object.assign(test, { status, durationMs, message }); return clone(test); }
  get(id) { return clone(this.#get(id)); }
  tree() { return [...this.tests.values()].map(clone); }
  #get(id) { const test = this.tests.get(id); if (!test) throw new Error(`unknown test: ${id}`); return test; }
}

export class WorkbenchState {
  constructor() {
    this.layout = { primarySideBar: true, secondarySideBar: false, panel: true, panelPosition: 'bottom', activity: 'explorer' };
    this.editors = new EditorGroupManager();
    this.problems = new ProblemsModel();
    this.tests = new TestExplorerModel();
  }
  toggle(area, visible = null) {
    if (area === 'primarySideBar') this.layout.primarySideBar = visible ?? !this.layout.primarySideBar;
    else if (area === 'secondarySideBar') this.layout.secondarySideBar = visible ?? !this.layout.secondarySideBar;
    else if (area === 'panel') this.layout.panel = visible ?? !this.layout.panel;
    else throw new Error(`unknown workbench area: ${area}`);
    return this.snapshot();
  }
  setActivity(activity) { this.layout.activity = activity; return this.snapshot(); }
  setPanelPosition(position) { if (!['bottom', 'right', 'left'].includes(position)) throw new Error('invalid panel position'); this.layout.panelPosition = position; return this.snapshot(); }
  snapshot() { return clone({ layout: this.layout, editors: this.editors.snapshot(), problems: this.problems.counts(), tests: this.tests.tree() }); }
}

function matchesType(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}
function matchesWhen(when, context) {
  if (when === 'always') return true;
  if (typeof when === 'function') return Boolean(when(context));
  return Boolean(context[when]);
}
