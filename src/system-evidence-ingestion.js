import crypto from 'node:crypto';

export class LanguageSemanticIngestor {
  constructor(graph) { this.graph = graph; }
  ingest({ document, symbols = [], references = [] }) {
    const file = unique(this.graph.query({ key: document }));
    const symbolIds = new Map();
    for (const symbol of flattenSymbols(symbols)) {
      const key = `${document}#${symbol.name}:${symbol.range?.start?.line ?? 0}:${symbol.range?.start?.character ?? 0}`;
      const id = stableId('symbol', key);
      symbolIds.set(symbol.name, id);
      this.graph.upsertNode({ id, kind: 'symbol', key, data: { name: symbol.name, kind: symbol.kind ?? null, range: symbol.range ?? null, detail: symbol.detail ?? null }, provenance: { source: 'language-server', document } });
      this.graph.link({ id: stableId('edge', `${file.id}:defines:${id}`), from: file.id, to: id, type: 'defines', provenance: { source: 'language-server', document } });
    }
    for (const reference of references) {
      const from = symbolIds.get(reference.from);
      const to = symbolIds.get(reference.to) ?? resolveSymbolByName(this.graph, reference.to);
      if (from && to) this.graph.link({ id: stableId('edge', `${from}:${reference.type ?? 'references'}:${to}`), from, to, type: reference.type ?? 'references', provenance: { source: 'language-server', document } });
    }
    return { symbols: symbolIds.size };
  }
}

export class RuntimeEvidenceIngestor {
  constructor(graph) { this.graph = graph; }
  ingest(observations = []) {
    for (const observation of observations) {
      if (!observation?.kind || !observation?.key) throw new Error('runtime observation requires kind and key');
      const id = stableId(observation.kind, observation.key);
      this.graph.upsertNode({ id, kind: observation.kind, key: observation.key, data: observation.data ?? {}, provenance: { source: 'runtime', observedAt: observation.observedAt ?? new Date().toISOString() } });
      for (const relation of observation.relations ?? []) {
        const target = resolveTarget(this.graph, relation.target);
        this.graph.link({ id: stableId('edge', `${id}:${relation.type}:${target.id}`), from: id, to: target.id, type: relation.type, data: relation.data ?? {}, provenance: { source: 'runtime' } });
      }
    }
    return { observations: observations.length };
  }
}

export class GitHistoryIngestor {
  constructor(graph) { this.graph = graph; }
  ingest(commits = []) {
    for (const commit of commits) {
      if (!/^[a-f0-9]{7,64}$/i.test(commit.sha ?? '')) throw new Error('invalid Git commit SHA');
      const commitId = stableId('commit', commit.sha);
      this.graph.upsertNode({ id: commitId, kind: 'commit', key: commit.sha, data: { author: commit.author ?? null, timestamp: commit.timestamp ?? null, message: commit.message ?? null }, provenance: { source: 'git' } });
      for (const filePath of commit.files ?? []) {
        const matches = this.graph.query({ key: filePath });
        if (matches.length !== 1) continue;
        this.graph.link({ id: stableId('edge', `${commitId}:changed:${matches[0].id}`), from: commitId, to: matches[0].id, type: 'changed', provenance: { source: 'git', sha: commit.sha } });
        if (commit.author) {
          const ownerId = stableId('owner', commit.author);
          this.graph.upsertNode({ id: ownerId, kind: 'owner', key: commit.author, data: {}, provenance: { source: 'git' } });
          this.graph.link({ id: stableId('edge', `${ownerId}:contributed:${matches[0].id}`), from: ownerId, to: matches[0].id, type: 'contributed', provenance: { source: 'git', sha: commit.sha } });
        }
      }
    }
    return { commits: commits.length };
  }
}

export class DeploymentEvidenceIngestor {
  constructor(graph) { this.graph = graph; }
  ingest({ deployments = [], infrastructure = [], tests = [] } = {}) {
    for (const item of infrastructure) this.#entity('infrastructure', item);
    for (const item of deployments) this.#entity('deployment', item);
    for (const item of tests) this.#entity('test', item);
    return { deployments: deployments.length, infrastructure: infrastructure.length, tests: tests.length };
  }
  #entity(kind, item) {
    if (!item?.key) throw new Error(`${kind} evidence requires key`);
    const id = stableId(kind, item.key);
    this.graph.upsertNode({ id, kind, key: item.key, data: item.data ?? {}, provenance: item.provenance ?? { source: 'workspace-evidence' } });
    for (const relation of item.relations ?? []) {
      const target = resolveTarget(this.graph, relation.target);
      this.graph.link({ id: stableId('edge', `${id}:${relation.type}:${target.id}`), from: id, to: target.id, type: relation.type, provenance: item.provenance ?? { source: 'workspace-evidence' } });
    }
  }
}

function flattenSymbols(symbols) {
  const output = [];
  const visit = (symbol) => { output.push(symbol); for (const child of symbol.children ?? []) visit(child); };
  for (const symbol of symbols) visit(symbol);
  return output;
}
function resolveTarget(graph, target) {
  const matches = graph.query({ predicate: (node) => node.id === target || node.key === target });
  return unique(matches);
}
function resolveSymbolByName(graph, name) {
  const matches = graph.query({ kinds: ['symbol'], predicate: (node) => node.data?.name === name });
  return matches.length === 1 ? matches[0].id : null;
}
function unique(matches) { if (matches.length !== 1) throw new Error(`expected one graph entity, found ${matches.length}`); return matches[0]; }
function stableId(kind, key) { return `${kind}:${crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 24)}`; }
