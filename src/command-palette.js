const clone = (value) => globalThis.structuredClone(value);

export class CommandPalette {
  constructor({ commands, keybindings = null, maxResults = 100 } = {}) {
    if (!commands || typeof commands.list !== 'function' || typeof commands.execute !== 'function') throw new TypeError('CommandPalette requires a CommandRegistry');
    this.commands = commands;
    this.keybindings = keybindings;
    this.maxResults = maxResults;
    this.history = [];
  }

  search(query = '', context = {}) {
    const needle = normalizeQuery(query);
    const entries = this.commands.list(context).map((command) => {
      const binding = this.#bindingFor(command.id, context);
      const score = fuzzyScore(needle, `${command.category ?? ''} ${command.title} ${command.id}`);
      return { ...command, keybinding: binding?.key ?? null, score };
    }).filter((entry) => needle === '' || entry.score >= 0)
      .sort((a, b) => b.score - a.score || this.#recency(b.id) - this.#recency(a.id) || a.title.localeCompare(b.title))
      .slice(0, this.maxResults)
      .map(({ score, ...entry }) => entry);
    return clone(entries);
  }

  async execute(id, args = undefined, context = {}) {
    const result = await this.commands.execute(id, args, context);
    this.history = [id, ...this.history.filter((entry) => entry !== id)].slice(0, 50);
    return result;
  }

  async accept(query, { index = 0, args, context = {} } = {}) {
    const result = this.search(query, context)[index];
    if (!result) throw new Error(`no command palette result for '${query}' at index ${index}`);
    return this.execute(result.id, args, context);
  }

  recent(context = {}) {
    const available = new Map(this.commands.list(context).map((command) => [command.id, command]));
    return this.history.filter((id) => available.has(id)).map((id) => ({ ...available.get(id), keybinding: this.#bindingFor(id, context)?.key ?? null }));
  }

  #bindingFor(command, context) {
    if (!this.keybindings?.bindings) return null;
    const candidates = this.keybindings.bindings.filter((binding) => binding.command === command && matchesWhen(binding.when, context));
    return candidates.at(-1) ?? null;
  }
  #recency(id) { const index = this.history.indexOf(id); return index < 0 ? -1 : this.history.length - index; }
}

export function installCoreCommands(commands, { workbench = null, extensions = null } = {}) {
  const disposers = [];
  const register = (id, title, category, handler) => disposers.push(commands.register(id, handler, { title, category }));
  register('workbench.action.showCommands', 'Show All Commands', 'View', async () => true);
  if (workbench) {
    register('workbench.view.explorer', 'View: Show Explorer', 'View', async () => workbench.setActivity('explorer'));
    register('workbench.view.extensions', 'View: Show Extensions', 'View', async () => workbench.setActivity('extensions'));
    register('workbench.action.togglePanel', 'View: Toggle Panel', 'View', async () => workbench.toggle('panel'));
    register('workbench.action.splitEditorRight', 'View: Split Editor Right', 'View', async () => workbench.editors.split('right'));
  }
  if (extensions) {
    register('extensions.showInstalled', 'Extensions: Show Installed Extensions', 'Extensions', async () => extensions.setFilter('installed'));
    register('extensions.showUpdates', 'Extensions: Show Available Updates', 'Extensions', async () => extensions.setFilter('updates'));
    register('extensions.checkForUpdates', 'Extensions: Check for Updates', 'Extensions', async () => extensions.refresh());
  }
  return () => { for (const dispose of disposers.splice(0)) dispose(); };
}

function normalizeQuery(query) { return String(query).trim().replace(/^>/, '').trim().toLowerCase(); }
function fuzzyScore(needle, haystack) {
  if (!needle) return 0;
  const target = haystack.toLowerCase();
  const exact = target.indexOf(needle);
  if (exact >= 0) return 10_000 - exact - (target.length - needle.length) * 0.01;
  let cursor = 0, score = 0, streak = 0;
  for (let index = 0; index < target.length && cursor < needle.length; index++) {
    if (target[index] === needle[cursor]) { cursor++; streak++; score += 10 + streak * 2; }
    else streak = 0;
  }
  return cursor === needle.length ? score : -1;
}
function matchesWhen(when, context) { if (when === 'always') return true; if (typeof when === 'function') return Boolean(when(context)); return Boolean(context[when]); }
