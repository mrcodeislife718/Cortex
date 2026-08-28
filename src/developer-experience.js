const clone = (value) => globalThis.structuredClone(value);

export class DeveloperExperience {
  constructor({ graph }) {
    if (!graph || typeof graph.query !== 'function' || typeof graph.impact !== 'function') {
      throw new TypeError('DeveloperExperience requires a Cortex System Graph');
    }
    this.graph = graph;
  }

  projectOverview() {
    const nodes = this.graph.query();
    const counts = {};
    for (const node of nodes) counts[node.kind] = (counts[node.kind] ?? 0) + 1;
    return {
      totalEntities: nodes.length,
      byKind: counts,
      files: nodes.filter((node) => node.kind === 'file').map(toReadableNode),
      packages: nodes.filter((node) => node.kind === 'package' || node.kind === 'dependency').map(toReadableNode),
    };
  }

  explainImpact(target, { maxDepth = 6 } = {}) {
    const node = this.#resolveTarget(target);
    const impacted = this.graph.impact([node.id], { maxDepth });
    const downstream = impacted.slice(1).map(toReadableNode);
    const direct = this.graph.neighbors(node.id, { direction: 'out' }).map(({ edge, node: neighbor }) => ({
      relation: edge.type,
      target: toReadableNode(neighbor),
    }));
    return {
      target: toReadableNode(node),
      direct,
      downstream,
      summary: summarizeImpact(node, downstream),
      verificationHints: verificationHints(downstream),
    };
  }

  dependenciesOf(target) {
    const node = this.#resolveTarget(target);
    return this.graph.neighbors(node.id, { direction: 'out' }).map(({ edge, node: neighbor }) => ({
      relation: edge.type,
      dependency: toReadableNode(neighbor),
    }));
  }

  dependentsOf(target) {
    const node = this.#resolveTarget(target);
    return this.graph.neighbors(node.id, { direction: 'in' }).map(({ edge, node: neighbor }) => ({
      relation: edge.type,
      dependent: toReadableNode(neighbor),
    }));
  }

  #resolveTarget(target) {
    const byId = this.graph.query({ predicate: (node) => node.id === target });
    if (byId.length === 1) return byId[0];
    const byKey = this.graph.query({ key: target });
    if (byKey.length === 1) return byKey[0];
    if (byKey.length > 1) throw new Error(`ambiguous Cortex target: ${target}`);
    throw new Error(`unknown Cortex target: ${target}`);
  }
}

function toReadableNode(node) {
  return {
    id: node.id,
    kind: node.kind,
    name: node.key ?? node.data?.name ?? node.id,
    data: clone(node.data ?? {}),
  };
}

function summarizeImpact(target, downstream) {
  if (downstream.length === 0) return `${target.key ?? target.id} has no known downstream impact in the current evidence graph.`;
  const counts = {};
  for (const node of downstream) counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  const detail = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([kind, count]) => `${count} ${kind}`).join(', ');
  return `${target.key ?? target.id} can affect ${downstream.length} known downstream entities: ${detail}.`;
}

function verificationHints(nodes) {
  const hints = new Set();
  for (const node of nodes) {
    if (node.kind === 'test') hints.add('Run affected tests.');
    if (node.kind === 'api' || node.kind === 'service') hints.add('Verify affected service/API behavior.');
    if (node.kind === 'schema' || node.kind === 'database') hints.add('Verify data compatibility and migrations.');
    if (node.kind === 'deployment' || node.kind === 'infrastructure') hints.add('Verify deployment and infrastructure impact.');
    if (node.kind === 'dependency') hints.add('Verify dependency compatibility and lockfile state.');
  }
  if (hints.size === 0 && nodes.length > 0) hints.add('Run the repository qualification suite for affected code.');
  return [...hints];
}
