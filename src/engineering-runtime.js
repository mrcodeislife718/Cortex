import crypto from 'node:crypto';
import { PromptBoundary } from './security-kernel.js';

const clone = (value) => globalThis.structuredClone(value);

export class ToolRegistry {
  constructor({ securityKernel = null } = {}) { this.securityKernel = securityKernel; this.tools = new Map(); }
  register(name, handler, { capability = null, executionLevel = 'OBSERVE', evidenceType = null } = {}) {
    if (!name || typeof handler !== 'function') throw new Error('tool name and handler are required');
    if (this.tools.has(name)) throw new Error(`duplicate tool: ${name}`);
    this.tools.set(name, { name, handler, capability, executionLevel, evidenceType });
    return this;
  }
  describe(name) { const tool = this.#get(name); const { handler, ...meta } = tool; return clone(meta); }
  async execute(name, args, { token = null, signal = null, context = {} } = {}) {
    const tool = this.#get(name);
    if (signal?.aborted) throw signal.reason ?? new Error('tool execution cancelled');
    if (tool.capability) this.securityKernel?.require(token, { capability: tool.capability, executionLevel: tool.executionLevel, resource: `tool:${name}` });
    const result = await tool.handler(clone(args), { signal, context: clone(context) });
    return { tool: name, result: clone(result), evidenceType: tool.evidenceType };
  }
  #get(name) { const tool = this.tools.get(name); if (!tool) throw new Error(`unknown tool: ${name}`); return tool; }
}

export class ContextAssembler {
  constructor({ providers = {}, promptBoundary = new PromptBoundary(), releasePolicy = null } = {}) {
    this.providers = providers;
    this.promptBoundary = promptBoundary;
    this.releasePolicy = releasePolicy;
  }
  async assemble(sources, request) {
    const parts = [{ source: 'user', text: request.input }];
    for (const source of sources) {
      const provider = this.providers[source];
      if (!provider) continue;
      const value = await provider(request);
      if (value === null || value === undefined) continue;
      parts.push({ source, text: typeof value === 'string' ? value : JSON.stringify(value) });
    }
    const compiled = this.promptBoundary.compile(parts);
    const release = this.releasePolicy?.inspect(compiled) ?? { allowed: true, findings: [], parts: compiled };
    return { parts: compiled, release };
  }
}

export class EngineeringRuntime {
  constructor({ orchestrator, modelRuntime, tools = new ToolRegistry(), contextAssembler = new ContextAssembler(), qualificationGate = null, ledger = null } = {}) {
    if (!orchestrator || !modelRuntime) throw new Error('engineering runtime requires orchestrator and model runtime');
    this.orchestrator = orchestrator;
    this.modelRuntime = modelRuntime;
    this.tools = tools;
    this.contextAssembler = contextAssembler;
    this.qualificationGate = qualificationGate;
    this.ledger = ledger;
  }

  async run(input, { token = null, preferredModels = [], signal = null, accountId = 'local', budgetUsd = Infinity, approved = false } = {}) {
    const route = this.orchestrator.route(input);
    if (route.requiresApproval && !approved) return { status: 'approval-required', route };
    const task = this.ledger?.begin({ goal: input, metadata: { route } });
    const context = await this.contextAssembler.assemble(route.contextSources, route);
    if (!context.release.allowed) {
      this.ledger?.finish(task.id, { status: 'failed', outcome: 'context-release-denied', evidence: context.release.findings });
      return { status: 'blocked', reason: 'context-release-denied', findings: context.release.findings, route };
    }
    const evidence = [];
    const toolResults = [];
    try {
      for (const toolName of route.tools.filter((name) => this.tools.tools.has(name))) {
        if (signal?.aborted) throw signal.reason ?? new Error('engineering task cancelled');
        const execution = await this.tools.execute(toolName, { input }, { token, signal, context: { route } });
        toolResults.push(execution);
        if (execution.evidenceType) evidence.push({ type: execution.evidenceType, ok: execution.result?.ok !== false, tool: toolName, result: execution.result });
        this.ledger?.record(task.id, 'tool.executed', { tool: toolName, evidenceType: execution.evidenceType });
      }

      const response = await this.modelRuntime.generate({ input, route, context: context.parts, toolResults }, { preferred: preferredModels, accountId, budgetUsd });
      evidence.push({ type: 'model', ok: true, provider: response.provider });
      const qualification = this.qualificationGate ? this.qualificationGate.evaluate(evidence) : { ok: true, missing: [], failures: [] };
      const status = route.requiresVerification && !qualification.ok ? 'verification-required' : 'completed';
      this.ledger?.finish(task.id, { status: status === 'completed' ? 'passed' : 'failed', outcome: response.result, evidence });
      return { id: task?.id ?? crypto.randomUUID(), status, route, result: response.result, provider: response.provider, costUsd: response.costUsd, toolResults, evidence, qualification };
    } catch (error) {
      if (task) this.ledger?.finish(task.id, { status: signal?.aborted ? 'cancelled' : 'failed', outcome: error.message, evidence });
      throw error;
    }
  }
}
