import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const clone = (value) => globalThis.structuredClone(value);

export class Workspace {
  constructor(root, { fileSystem = fs } = {}) { this.root = path.resolve(root); this.fileSystem = fileSystem; this.openFiles = new Map(); this.projects = new Map(); }
  async discover({ extensions = ['.cannon', '.cannon+', '.scout', '.scout-d', '.js', '.ts'] } = {}) {
    const files = [];
    const walk = async (dir) => {
      for (const entry of await this.fileSystem.readdir(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (extensions.some((ext) => entry.name.endsWith(ext))) files.push(full);
      }
    };
    await walk(this.root);
    return files.sort();
  }
  async open(file) { const full = this.#resolve(file); const text = await this.fileSystem.readFile(full, 'utf8'); const document = new TextDocument(full, text); this.openFiles.set(full, document); return document; }
  async save(file) { const full = this.#resolve(file); const document = this.openFiles.get(full); if (!document) throw new Error(`file is not open: ${file}`); await this.fileSystem.writeFile(full, document.text, 'utf8'); document.markSaved(); return document.version; }
  #resolve(file) { const full = path.resolve(this.root, file); if (!full.startsWith(this.root + path.sep) && full !== this.root) throw new Error('path escapes workspace'); return full; }
}

export class TextDocument extends EventEmitter {
  constructor(uri, text = '') { super(); this.uri = uri; this.text = text; this.version = 1; this.savedVersion = 1; this.history = []; }
  applyEdit({ start, end = start, text }) { if (![start, end].every(Number.isInteger) || start < 0 || end < start || end > this.text.length) throw new RangeError('invalid edit range'); const before = this.text.slice(start, end); this.text = this.text.slice(0, start) + text + this.text.slice(end); this.version++; const edit = { id: crypto.randomUUID(), start, end, before, after: text, version: this.version }; this.history.push(edit); this.emit('change', edit); return edit; }
  undo() { const edit = this.history.pop(); if (!edit) return false; const end = edit.start + edit.after.length; this.text = this.text.slice(0, edit.start) + edit.before + this.text.slice(end); this.version++; this.emit('change', { undo: edit.id, version: this.version }); return true; }
  markSaved() { this.savedVersion = this.version; }
  get dirty() { return this.savedVersion !== this.version; }
}

export class LanguageClientRegistry {
  constructor() { this.clients = new Map(); }
  register(language, client) { if (!client || typeof client.request !== 'function') throw new TypeError('language client must implement request()'); this.clients.set(language, client); return this; }
  get(language) { const client = this.clients.get(language); if (!client) throw new Error(`no language client for ${language}`); return client; }
  async diagnostics(language, document) { return this.get(language).request('textDocument/diagnostic', { uri: document.uri, version: document.version, text: document.text }); }
  async symbols(language, document) { return this.get(language).request('textDocument/documentSymbol', { uri: document.uri, text: document.text }); }
  async rename(language, document, position, newName) { return this.get(language).request('textDocument/rename', { uri: document.uri, text: document.text, position, newName }); }
}

export class DiagnosticStore {
  constructor() { this.byUri = new Map(); }
  replace(uri, diagnostics = []) { this.byUri.set(uri, diagnostics.map(normalizeDiagnostic)); return this.get(uri); }
  get(uri) { return clone(this.byUri.get(uri) ?? []); }
  all() { return [...this.byUri.entries()].flatMap(([uri, diagnostics]) => diagnostics.map((diagnostic) => ({ uri, ...clone(diagnostic) }))); }
  at(uri, offset) { return this.get(uri).filter((diagnostic) => offset >= diagnostic.start && offset <= diagnostic.end); }
}

export class SymbolGraph {
  constructor() { this.symbols = new Map(); this.edges = []; }
  ingest(uri, symbols = []) { for (const symbol of symbols) { const id = symbol.id ?? `${uri}:${symbol.name}:${symbol.start ?? 0}`; this.symbols.set(id, { id, uri, ...clone(symbol) }); for (const ref of symbol.references ?? []) this.edges.push({ from: id, to: ref, type: 'reference' }); if (symbol.parent) this.edges.push({ from: symbol.parent, to: id, type: 'contains' }); } }
  find(name) { return [...this.symbols.values()].filter((symbol) => name === undefined || symbol.name === name).map((symbol) => clone(symbol)); }
  references(id) { return this.edges.filter((edge) => edge.from === id || edge.to === id).map((edge) => clone(edge)); }
}

export class DebugSession extends EventEmitter {
  constructor(adapter) { super(); this.adapter = adapter; this.breakpoints = new Map(); this.state = 'created'; }
  async start(config = {}) { this.state = 'running'; const result = await this.adapter.start?.(config); this.emit('state', this.state); return result; }
  setBreakpoint(uri, line) { const key = `${uri}:${line}`; this.breakpoints.set(key, { uri, line, enabled: true }); return this.breakpoints.get(key); }
  async inspect(frameId, expression) { return this.adapter.evaluate?.({ frameId, expression }); }
  async continue() { return this.adapter.continue?.(); }
  async pause() { return this.adapter.pause?.(); }
  async stop() { this.state = 'stopped'; const result = await this.adapter.stop?.(); this.emit('state', this.state); return result; }
}

export class ProvenanceView {
  constructor() { this.nodes = new Map(); this.links = []; }
  add(node) { if (!node?.id) throw new Error('provenance node requires id'); this.nodes.set(node.id, clone(node)); return this; }
  link(from, to, relation, evidence = null) { if (!this.nodes.has(from) || !this.nodes.has(to)) throw new Error('provenance link references unknown node'); this.links.push({ from, to, relation, evidence: clone(evidence) }); return this; }
  trace(id) { const visited = new Set(), queue = [id], output = []; while (queue.length) { const current = queue.shift(); if (visited.has(current)) continue; visited.add(current); const node = this.nodes.get(current); if (node) output.push(clone(node)); for (const edge of this.links) if (edge.from === current) queue.push(edge.to); } return output; }
}

export class TerminalManager extends EventEmitter {
  constructor({ spawn }) { super(); this.spawn = spawn; this.terminals = new Map(); }
  create(command, args = [], options = {}) { const id = crypto.randomUUID(); const child = this.spawn(command, args, options); this.terminals.set(id, child); child.on?.('exit', (code) => { this.emit('exit', { id, code }); this.terminals.delete(id); }); return { id, process: child }; }
  kill(id, signal = 'SIGTERM') { const child = this.terminals.get(id); if (!child) return false; child.kill(signal); return true; }
}

export class GitModel {
  constructor(adapter) { this.adapter = adapter; }
  status() { return this.adapter.status(); }
  diff(file) { return this.adapter.diff(file); }
  commit(message, files) { return this.adapter.commit(message, files); }
  branches() { return this.adapter.branches(); }
}

export class EcosystemPanels {
  constructor() { this.providers = new Map(); }
  register(name, provider) { this.providers.set(name, provider); return this; }
  async data(name, context = {}) { const provider = this.providers.get(name); if (!provider) throw new Error(`unknown Cortex panel: ${name}`); return provider(context); }
}

export class MemoryInspector {
  constructor() { this.snapshots = []; }
  capture(snapshot) { const normalized = { id: crypto.randomUUID(), at: new Date().toISOString(), allocations: [], regions: [], pointers: [], ...clone(snapshot) }; this.snapshots.push(normalized); return clone(normalized); }
  leaks() { const latest = this.snapshots.at(-1); if (!latest) return []; return latest.allocations.filter((allocation) => !allocation.released && !allocation.regionReleased).map((allocation) => clone(allocation)); }
  danglingPointers() { const latest = this.snapshots.at(-1); if (!latest) return []; const live = new Set(latest.allocations.filter((allocation) => !allocation.released).map((allocation) => allocation.id)); return latest.pointers.filter((pointer) => pointer.target && !live.has(pointer.target)).map((pointer) => clone(pointer)); }
}

export class AIEditEngine {
  constructor(provider, { validate } = {}) { this.provider = provider; this.validate = validate ?? (async () => ({ ok: true })); }
  async propose({ files, instruction, context = {} }) { const proposal = await this.provider.generate({ files: clone(files), instruction, context: clone(context) }); if (!Array.isArray(proposal?.edits)) throw new Error('AI provider returned invalid edit proposal'); const validation = await this.validate(proposal); return { id: crypto.randomUUID(), status: validation.ok ? 'review' : 'rejected', validation: clone(validation), ...clone(proposal) }; }
  apply(document, proposal, editIndex) { if (proposal.status !== 'review') throw new Error('proposal is not approved for review'); const edit = proposal.edits[editIndex]; if (!edit) throw new Error('unknown proposal edit'); return document.applyEdit(edit); }
}

export class ReleaseController {
  constructor({ velocity, chronos }) { this.velocity = velocity; this.chronos = chronos; }
  plan(app, options) { return this.velocity.createBuildPlan(app, options); }
  deploy(releaseSpec) { return this.chronos.createRelease(releaseSpec); }
  promote(id, threshold) { return this.chronos.promote(id, threshold); }
  rollback(environment, channel) { return this.chronos.rollback(environment, channel); }
}

export class Cortex {
  constructor({ workspace, languages = new LanguageClientRegistry(), diagnostics = new DiagnosticStore(), symbols = new SymbolGraph(), panels = new EcosystemPanels() } = {}) { this.workspace = workspace; this.languages = languages; this.diagnostics = diagnostics; this.symbols = symbols; this.panels = panels; }
  async analyze(language, document) { const [diagnostics, symbols] = await Promise.all([this.languages.diagnostics(language, document), this.languages.symbols(language, document)]); this.diagnostics.replace(document.uri, diagnostics ?? []); this.symbols.ingest(document.uri, symbols ?? []); return { diagnostics: this.diagnostics.get(document.uri), symbols: this.symbols.find() }; }
}

function normalizeDiagnostic(diagnostic) { return { severity: diagnostic.severity ?? 'error', code: diagnostic.code ?? null, message: diagnostic.message ?? '', start: diagnostic.start ?? diagnostic.range?.start ?? 0, end: diagnostic.end ?? diagnostic.range?.end ?? diagnostic.start ?? 0, source: diagnostic.source ?? 'nova', data: clone(diagnostic.data ?? null) }; }
