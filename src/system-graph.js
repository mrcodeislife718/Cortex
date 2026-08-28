import crypto from 'node:crypto';

const clone = (value) => globalThis.structuredClone(value);

export class CortexSystemGraph {
  constructor({ clock = () => new Date().toISOString() } = {}) {
    this.clock = clock;
    this.nodes = new Map();
    this.edges = new Map();
    this.version = 0;
  }

  upsertNode({ id = crypto.randomUUID(), kind, key = null, data = {}, provenance = null }) {
    if (!kind) throw new Error('system graph node kind is required');
    const previous = this.nodes.get(id);
    const node = {
      id,
      kind,
      key,
      data: clone(data),
      provenance: clone(provenance),
      createdAt: previous?.createdAt ?? this.clock(),
      updatedAt: this.clock(),
      revision: (previous?.revision ?? 0) + 1,
    };
    this.nodes.set(id, node);
    this.version++;
    return clone(node);
  }

  removeNode(id) {
    if (!this.nodes.delete(id)) return false;
    for (const [edgeId, edge] of this.edges) {
      if (edge.from === id || edge.to === id) this.edges.delete(edgeId);
    }
    this.version++;
    return true;
  }

  link({ id = crypto.randomUUID(), from, to, type, data = {}, provenance = null }) {
    if (!this.nodes.has(from) || !this.nodes.has(to)) throw new Error('system graph edge references unknown node');
    if (!type) throw new Error('system graph edge type is required');
    const edge = { id, from, to, type, data: clone(data), provenance: clone(provenance), createdAt: this.clock() };
    this.edges.set(id, edge);
    this.version++;
    return clone(edge);
  }

  query({ kinds, key, predicate } = {}) {
    const allowedKinds = kinds ? new Set(kinds) : null;
    return [...this.nodes.values()]
      .filter((node) => !allowedKinds || allowedKinds.has(node.kind))
      .filter((node) => key === undefined || node.key === key)
      .filter((node) => !predicate || predicate(clone(node)))
      .map(clone);
  }

  neighbors(id, { direction = 'both', types } = {}) {
    const allowedTypes = types ? new Set(types) : null;
    const result = [];
    for (const edge of this.edges.values()) {
      if (allowedTypes && !allowedTypes.has(edge.type)) continue;
      const outgoing = edge.from === id;
      const incoming = edge.to === id;
      if ((direction === 'out' && !outgoing) || (direction === 'in' && !incoming) || (!outgoing && !incoming)) continue;
      const otherId = outgoing ? edge.to : edge.from;
      const node = this.nodes.get(otherId);
      if (node) result.push({ edge: clone(edge), node: clone(node) });
    }
    return result;
  }

  impact(startIds, { maxDepth = 8, edgeTypes } = {}) {
    const queue = startIds.map((id) => ({ id, depth: 0 }));
    const visited = new Set();
    const output = [];
    while (queue.length) {
      const current = queue.shift();
      if (visited.has(current.id) || current.depth > maxDepth) continue;
      visited.add(current.id);
      const node = this.nodes.get(current.id);
      if (node) output.push({ ...clone(node), depth: current.depth });
      if (current.depth === maxDepth) continue;
      for (const { node: neighbor } of this.neighbors(current.id, { direction: 'out', types: edgeTypes })) {
        queue.push({ id: neighbor.id, depth: current.depth + 1 });
      }
    }
    return output;
  }

  snapshot() {
    return {
      schema: 'cortex.system-graph/v1',
      version: this.version,
      nodes: [...this.nodes.values()].map(clone),
      edges: [...this.edges.values()].map(clone),
    };
  }

  restore(snapshot) {
    if (snapshot?.schema !== 'cortex.system-graph/v1') throw new Error('unsupported system graph snapshot');
    this.nodes = new Map((snapshot.nodes ?? []).map((node) => [node.id, clone(node)]));
    this.edges = new Map((snapshot.edges ?? []).map((edge) => [edge.id, clone(edge)]));
    for (const edge of this.edges.values()) {
      if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) throw new Error('corrupt system graph snapshot');
    }
    this.version = snapshot.version ?? 0;
    return this;
  }
}
