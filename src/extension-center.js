const clone = (value) => globalThis.structuredClone(value);

export class ExtensionCenter {
  constructor({ platform, catalog = [], updateProvider = null, commandRegistry = null } = {}) {
    if (!platform || typeof platform.list !== 'function') throw new TypeError('ExtensionCenter requires an ExtensionPlatform');
    this.platform = platform;
    this.catalog = new Map(catalog.map((entry) => [entry.id, clone(entry)]));
    this.updateProvider = updateProvider;
    this.commandRegistry = commandRegistry;
    this.filter = 'all';
    this.query = '';
    this.updates = new Map();
    this.commandDisposers = new Map();
  }

  setFilter(filter) {
    if (!['all','installed','enabled','disabled','updates','first-party'].includes(filter)) throw new Error(`unknown extension filter: ${filter}`);
    this.filter = filter;
    return this.snapshot();
  }

  setQuery(query = '') { this.query = String(query); return this.snapshot(); }

  browse({ query = this.query, filter = this.filter } = {}) {
    const installed = new Map(this.platform.list().map((state) => [state.manifest.id, state]));
    const ids = new Set([...this.catalog.keys(), ...installed.keys()]);
    const needle = query.trim().toLowerCase();
    const rows = [...ids].map((id) => {
      const state = installed.get(id) ?? null;
      const catalog = this.catalog.get(id) ?? state?.manifest ?? {};
      const latestVersion = this.updates.get(id)?.version ?? catalog.version ?? state?.manifest.version ?? null;
      const installedVersion = state?.manifest.version ?? null;
      const updateAvailable = Boolean(installedVersion && latestVersion && compareVersions(latestVersion, installedVersion) > 0);
      return {
        id,
        name: catalog.displayName ?? catalog.name ?? id,
        description: catalog.description ?? '',
        publisher: catalog.publisher ?? null,
        firstParty: Boolean(catalog.firstParty),
        installed: Boolean(state),
        enabled: state?.enabled ?? false,
        status: state?.status ?? 'available',
        version: installedVersion,
        latestVersion,
        updateAvailable,
        contributions: clone(state?.manifest.contributions ?? catalog.contributions ?? {}),
        conflicts: clone(state?.conflicts ?? [])
      };
    }).filter((row) => {
      if (needle && !`${row.name} ${row.id} ${row.publisher ?? ''} ${row.description}`.toLowerCase().includes(needle)) return false;
      if (filter === 'installed') return row.installed;
      if (filter === 'enabled') return row.installed && row.enabled;
      if (filter === 'disabled') return row.installed && !row.enabled;
      if (filter === 'updates') return row.updateAvailable;
      if (filter === 'first-party') return row.firstParty;
      return true;
    }).sort((a,b) => Number(b.firstParty)-Number(a.firstParty) || Number(b.installed)-Number(a.installed) || a.name.localeCompare(b.name));
    return clone(rows);
  }

  details(id) {
    const row = this.browse({ filter:'all', query:'' }).find((entry) => entry.id === id);
    if (!row) throw new Error(`unknown extension: ${id}`);
    return row;
  }

  install(id) {
    const manifest = this.catalog.get(id);
    if (!manifest) throw new Error(`extension is not in the Cortex catalog: ${id}`);
    const state = this.platform.install(manifest);
    this.#registerCommands(state.manifest);
    return this.details(id);
  }

  enable(id) { const state = this.platform.enable(id); this.#registerCommands(state.manifest); return this.details(id); }
  disable(id) { this.#disposeCommands(id); this.platform.disable(id); return this.details(id); }
  uninstall(id) { this.#disposeCommands(id); const removed = this.platform.uninstall(id); return { id, removed }; }

  registerInstalledContributions() {
    for (const state of this.platform.list()) if (state.enabled) this.#registerCommands(state.manifest);
  }

  async refresh() {
    if (!this.updateProvider) return this.snapshot();
    const result = await this.updateProvider({ installed:this.platform.list().map((state) => ({ id:state.manifest.id, version:state.manifest.version })) });
    this.updates.clear();
    for (const update of result ?? []) if (update?.id && update?.version) this.updates.set(update.id, clone(update));
    return this.snapshot();
  }

  snapshot() { return { filter:this.filter, query:this.query, counts:this.counts(), extensions:this.browse() }; }
  counts() {
    const all = this.browse({ filter:'all', query:'' });
    return {
      all:all.length,
      installed:all.filter((entry)=>entry.installed).length,
      enabled:all.filter((entry)=>entry.installed&&entry.enabled).length,
      disabled:all.filter((entry)=>entry.installed&&!entry.enabled).length,
      updates:all.filter((entry)=>entry.updateAvailable).length,
      firstParty:all.filter((entry)=>entry.firstParty).length
    };
  }

  #registerCommands(manifest) {
    if (!this.commandRegistry) return;
    this.#disposeCommands(manifest.id);
    const disposers = [];
    for (const command of manifest.contributions?.commands ?? []) {
      if (!command?.id || !command?.title) continue;
      disposers.push(this.commandRegistry.register(command.id, async (args, context) => {
        if (typeof command.execute === 'function') return command.execute(args, context);
        return { extension:manifest.id, command:command.id, args:clone(args), context:clone(context) };
      }, { title:command.title, category:command.category ?? manifest.displayName ?? manifest.name ?? manifest.id }));
    }
    this.commandDisposers.set(manifest.id, disposers);
  }

  #disposeCommands(id) {
    for (const dispose of this.commandDisposers.get(id) ?? []) dispose();
    this.commandDisposers.delete(id);
  }
}

function compareVersions(a,b) {
  const left=String(a).split(/[.+-]/)[0].split('.').map((part)=>Number(part)||0);
  const right=String(b).split(/[.+-]/)[0].split('.').map((part)=>Number(part)||0);
  for(let i=0;i<Math.max(left.length,right.length);i++){const diff=(left[i]??0)-(right[i]??0);if(diff)return diff;}
  return String(a).localeCompare(String(b));
}
