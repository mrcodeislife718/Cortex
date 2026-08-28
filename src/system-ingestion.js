import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { CortexSystemGraph } from './system-graph.js';

const SOURCE_EXTENSIONS = new Set(['.js','.mjs','.cjs','.ts','.tsx','.jsx']);
const IGNORED_DIRECTORIES = new Set(['.git','node_modules','dist','build','coverage','.next','.turbo']);

export class WorkspaceGraphIngestor {
  constructor(root, { fileSystem = fs, graph = new CortexSystemGraph() } = {}) {
    this.root = path.resolve(root);
    this.fileSystem = fileSystem;
    this.graph = graph;
    this.fileIds = new Map();
  }

  async ingest() {
    const files = await this.#walk(this.root);
    const relativeFiles = new Set(files.map((file) => this.#relative(file)));
    const packageFile = path.join(this.root, 'package.json');
    await this.#ingestPackage(packageFile).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });

    for (const file of files) await this.#ingestFile(file);
    for (const file of files) await this.#ingestImports(file, relativeFiles);

    return {
      root: this.root,
      files: files.length,
      nodes: this.graph.nodes.size,
      edges: this.graph.edges.size,
      graph: this.graph,
    };
  }

  async #walk(dir) {
    const output = [];
    for (const entry of await this.fileSystem.readdir(dir, { withFileTypes: true })) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) output.push(...await this.#walk(full));
      else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) output.push(full);
    }
    return output.sort();
  }

  async #ingestPackage(packageFile) {
    const raw = await this.fileSystem.readFile(packageFile, 'utf8');
    const manifest = JSON.parse(raw);
    const id = stableId('package', this.#relative(packageFile));
    this.graph.upsertNode({
      id,
      kind: 'package',
      key: manifest.name ?? this.#relative(packageFile),
      data: {
        version: manifest.version ?? null,
        type: manifest.type ?? null,
        engines: manifest.engines ?? null,
      },
      provenance: { source: 'package.json', path: this.#relative(packageFile) },
    });
    for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
      const dependencyId = stableId('dependency', name);
      this.graph.upsertNode({ id: dependencyId, kind: 'dependency', key: name, data: { version }, provenance: { source: 'package.json' } });
      this.graph.link({ id: stableId('edge', `${id}:depends-on:${dependencyId}`), from: id, to: dependencyId, type: 'depends-on', provenance: { source: 'package.json' } });
    }
  }

  async #ingestFile(file) {
    const relative = this.#relative(file);
    const text = await this.fileSystem.readFile(file, 'utf8');
    const stat = await this.fileSystem.stat(file);
    const id = stableId('file', relative);
    this.fileIds.set(relative, id);
    this.graph.upsertNode({
      id,
      kind: 'file',
      key: relative,
      data: {
        extension: path.extname(relative),
        bytes: Buffer.byteLength(text),
        lines: text.length ? text.split(/\r?\n/).length : 0,
        sha256: crypto.createHash('sha256').update(text).digest('hex'),
        modifiedMs: stat.mtimeMs,
      },
      provenance: { source: 'filesystem', path: relative },
    });
  }

  async #ingestImports(file, relativeFiles) {
    const relative = this.#relative(file);
    const fromId = this.fileIds.get(relative);
    const text = await this.fileSystem.readFile(file, 'utf8');
    const specifiers = extractModuleSpecifiers(text);
    for (const specifier of specifiers) {
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        const resolved = resolveWorkspaceSpecifier(relative, specifier, relativeFiles);
        if (!resolved) continue;
        const toId = this.fileIds.get(resolved);
        if (!toId) continue;
        this.graph.link({
          id: stableId('edge', `${fromId}:imports:${toId}:${specifier}`),
          from: fromId,
          to: toId,
          type: 'imports',
          data: { specifier },
          provenance: { source: 'source-analysis', path: relative },
        });
      } else {
        const packageName = normalizePackageSpecifier(specifier);
        const dependencyId = stableId('dependency', packageName);
        if (!this.graph.nodes.has(dependencyId)) this.graph.upsertNode({ id: dependencyId, kind: 'dependency', key: packageName, data: { declared: false }, provenance: { source: 'source-analysis' } });
        this.graph.link({
          id: stableId('edge', `${fromId}:imports:${dependencyId}:${specifier}`),
          from: fromId,
          to: dependencyId,
          type: 'imports',
          data: { specifier },
          provenance: { source: 'source-analysis', path: relative },
        });
      }
    }
  }

  #relative(file) {
    const relative = path.relative(this.root, path.resolve(file));
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('path escapes workspace');
    return relative.split(path.sep).join('/');
  }
}

export function extractModuleSpecifiers(text) {
  const matches = new Set();
  const patterns = [
    /\bimport\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+[^'";]+?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) matches.add(match[1]);
  }
  return [...matches];
}

function resolveWorkspaceSpecifier(fromRelative, specifier, files) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRelative), specifier));
  const candidates = [
    base,
    ...[...SOURCE_EXTENSIONS].map((ext) => `${base}${ext}`),
    ...[...SOURCE_EXTENSIONS].map((ext) => path.posix.join(base, `index${ext}`)),
  ];
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

function normalizePackageSpecifier(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function stableId(kind, key) {
  return `${kind}:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
}
