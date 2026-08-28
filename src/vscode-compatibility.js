const clone = (value) => globalThis.structuredClone(value);

const SUPPORTED_CONTRIBUTIONS = new Set([
  'commands', 'configuration', 'keybindings', 'languages', 'grammars', 'themes', 'iconThemes',
  'debuggers', 'taskDefinitions', 'problemMatchers', 'snippets', 'jsonValidation', 'views', 'viewsContainers',
]);

export class VsCodeExtensionAdapter {
  constructor({ apiVersion = '1', allowUnsupported = false } = {}) {
    this.apiVersion = apiVersion;
    this.allowUnsupported = allowUnsupported;
  }

  translate(packageJson) {
    if (!packageJson?.name || !packageJson?.version) throw new Error('VS Code extension manifest requires name and version');
    const publisher = packageJson.publisher ?? 'unpublished';
    const id = `${publisher}.${packageJson.name}`;
    const activationEvents = normalizeActivationEvents(packageJson.activationEvents ?? inferActivationEvents(packageJson.contributes ?? {}));
    const { contributions, unsupported } = translateContributions(packageJson.contributes ?? {});
    if (unsupported.length && !this.allowUnsupported) throw new UnsupportedVsCodeExtensionError(id, unsupported);
    const capabilities = inferCapabilities(packageJson, contributions);
    return {
      id,
      version: packageJson.version,
      runtime: inferRuntime(contributions),
      activationEvents,
      startupJustification: activationEvents.includes('*') ? `Compatibility requirement declared by ${id}` : null,
      capabilities,
      executionLevel: capabilities.some((cap) => cap.startsWith('execute.') || cap.startsWith('network.')) ? 'WORKSPACE_EXECUTE' : 'OBSERVE',
      compatibility: { vscode: true, apiVersion: this.apiVersion, engines: clone(packageJson.engines ?? {}) },
      contributions,
      compatibilityReport: {
        supported: unsupported.length === 0,
        unsupported,
        entrypoint: packageJson.browser ?? packageJson.main ?? null,
        extensionKind: clone(packageJson.extensionKind ?? null),
      },
    };
  }

  qualify(packageJson) {
    try {
      const manifest = this.translate(packageJson);
      return { compatible: true, manifest, unsupported: [] };
    } catch (error) {
      if (error instanceof UnsupportedVsCodeExtensionError) return { compatible: false, manifest: null, unsupported: error.unsupported };
      throw error;
    }
  }
}

export class VsCodeCompatibilityRegistry {
  constructor({ adapter = new VsCodeExtensionAdapter({ allowUnsupported: true }) } = {}) { this.adapter = adapter; this.results = new Map(); }
  assess(packageJson) {
    const result = this.adapter.qualify(packageJson);
    const id = packageJson.publisher ? `${packageJson.publisher}.${packageJson.name}` : packageJson.name;
    this.results.set(id, { ...result, assessedAt: new Date().toISOString() });
    return clone(this.results.get(id));
  }
  summary() {
    const values = [...this.results.values()];
    return { total: values.length, compatible: values.filter((item) => item.compatible).length, incompatible: values.filter((item) => !item.compatible).length, results: clone(values) };
  }
}

export class UnsupportedVsCodeExtensionError extends Error {
  constructor(id, unsupported) {
    super(`VS Code extension ${id} uses unsupported contributions: ${unsupported.join(', ')}`);
    this.name = 'UnsupportedVsCodeExtensionError';
    this.unsupported = [...unsupported];
  }
}

function translateContributions(contributes) {
  const contributions = {};
  const unsupported = [];
  for (const [key, value] of Object.entries(contributes)) {
    if (!SUPPORTED_CONTRIBUTIONS.has(key)) { unsupported.push(key); continue; }
    if (key === 'languages') contributions.languages = (value ?? []).map((item) => item.id).filter(Boolean);
    else if (key === 'commands') contributions.commands = (value ?? []).map((item) => item.command).filter(Boolean);
    else if (key === 'debuggers') contributions.debuggers = (value ?? []).map((item) => item.type).filter(Boolean);
    else if (key === 'themes') contributions.themes = (value ?? []).map((item) => item.id ?? item.label).filter(Boolean);
    else if (key === 'configuration') contributions.settings = Array.isArray(value) ? value.flatMap((item) => Object.keys(item.properties ?? {})) : Object.keys(value?.properties ?? {});
    else contributions[key] = clone(value);
  }
  return { contributions, unsupported: unsupported.sort() };
}

function normalizeActivationEvents(events) {
  return [...new Set(events.map((event) => {
    if (event === '*') return '*';
    if (event.startsWith('onLanguage:')) return event;
    if (event.startsWith('onCommand:')) return event;
    if (event.startsWith('workspaceContains:')) return event;
    if (event === 'onStartupFinished') return 'onStartup';
    return `vscode:${event}`;
  }))];
}

function inferActivationEvents(contributes) {
  const events = [];
  for (const command of contributes.commands ?? []) if (command.command) events.push(`onCommand:${command.command}`);
  for (const language of contributes.languages ?? []) if (language.id) events.push(`onLanguage:${language.id}`);
  return events;
}

function inferCapabilities(packageJson, contributions) {
  const capabilities = new Set(['read.workspace']);
  if (packageJson.main) capabilities.add('execute.extension-node');
  if (contributions.debuggers?.length || contributions.taskDefinitions?.length) capabilities.add('execute.workspace');
  if (packageJson.extensionKind?.includes?.('workspace')) capabilities.add('write.workspace');
  return [...capabilities];
}

function inferRuntime(contributions) {
  if (contributions.languages?.length || contributions.grammars?.length) return 'language';
  if (contributions.debuggers?.length || contributions.taskDefinitions?.length) return 'tool';
  return 'workspace';
}
