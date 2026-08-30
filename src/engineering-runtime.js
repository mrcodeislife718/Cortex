import crypto from 'node:crypto';
import { PromptBoundary } from './security-kernel.js';
import { EngineeringKnowledgeStore, WorkOrder, VerificationPack, ClosedLoopEngineeringCycle } from './software-factory.js';

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
  constructor({ orchestrator, modelRuntime, tools = new ToolRegistry(), contextAssembler = new ContextAssembler(), qualificationGate = null, ledger = null, knowledge = new EngineeringKnowledgeStore() } = {}) {
    if (!orchestrator || !modelRuntime) throw new Error('engineering runtime requires orchestrator and model runtime');
    this.orchestrator = orchestrator;
    this.modelRuntime = modelRuntime;
    this.tools = tools;
    this.contextAssembler = contextAssembler;
    this.qualificationGate = qualificationGate;
    this.ledger = ledger;
    this.knowledge = knowledge;
  }

  async run(input, { token = null, preferredModels = [], signal = null, accountId = 'local', budgetUsd = Infinity, approved = false } = {}) {
    const route = this.orchestrator.route(input);
    const requiredEvidence = route.requiresVerification
      ? [...new Set([...(this.qualificationGate?.required ?? ['independent-verification']), 'model'])]
      : ['model'];
    const workOrder = new WorkOrder({
      goal: input,
      inputs: route.contextSources ?? [],
      expectedOutputs: ['evidence-backed engineering outcome'],
      wiringNotes: (route.tools ?? []).map((tool) => ({ tool })),
      verification: requiredEvidence,
      authority: route.executionLevel ?? (route.requiresApproval ? 'EXTERNAL_SIDE_EFFECT' : 'SAFE_EDIT'),
      metadata: { depth: route.depth, agents: route.agents ?? [] },
    });
    const verificationPack = new VerificationPack({ workOrderId: workOrder.id, required: requiredEvidence });
    const cycle = new ClosedLoopEngineeringCycle({ workOrder, knowledge: this.knowledge });
    cycle.record({ route }, { evidence: { type: 'intent-routing' } });

    if (route.requiresApproval && !approved) {
      workOrder.addAction({ type: 'authorization.required', executionLevel: workOrder.authority });
      return { status: 'approval-required', route, workOrder: workOrder.snapshot(), verificationPack: verificationPack.snapshot(), cycle: cycle.snapshot() };
    }

    workOrder.transition('authorized');
    cycle.advance('decide');
    cycle.record({ contextSources: route.contextSources ?? [], tools: route.tools ?? [], agents: route.agents ?? [] });
    const task = this.ledger?.begin({ goal: input, metadata: { route, workOrderId: workOrder.id } });
    const context = await this.contextAssembler.assemble(route.contextSources ?? [], route);
    if (!context.release.allowed) {
      workOrder.addAction({ type: 'context.blocked', findings: context.release.findings });
      workOrder.transition('halted');
      verificationPack.addEvidence('context-release', context.release.findings, { ok: false, source: 'context-boundary' });
      if (task) this.ledger?.finish(task.id, { status: 'failed', outcome: 'context-release-denied', evidence: context.release.findings });
      return { status: 'blocked', reason: 'context-release-denied', findings: context.release.findings, route, workOrder: workOrder.snapshot(), verificationPack: verificationPack.snapshot(), cycle: cycle.snapshot() };
    }

    const evidence = [];
    const toolResults = [];
    try {
      cycle.advance('act');
      workOrder.transition('executing');
      for (const toolName of (route.tools ?? []).filter((name) => this.tools.tools.has(name))) {
        if (signal?.aborted) throw signal.reason ?? new Error('engineering task cancelled');
        const execution = await this.tools.execute(toolName, { input }, { token, signal, context: { route, workOrderId: workOrder.id } });
        toolResults.push(execution);
        workOrder.addAction({ type: 'tool.executed', tool: toolName, evidenceType: execution.evidenceType });
        if (execution.evidenceType) {
          const item = { type: execution.evidenceType, ok: execution.result?.ok !== false, tool: toolName, result: execution.result };
          evidence.push(item);
          verificationPack.addEvidence(item.type, item.result, { ok: item.ok, source: toolName });
        }
        if (task) this.ledger?.record(task.id, 'tool.executed', { tool: toolName, evidenceType: execution.evidenceType });
      }

      const response = await this.modelRuntime.generate({ input, route, context: context.parts, toolResults, workOrder: workOrder.snapshot() }, { preferred: preferredModels, accountId, budgetUsd });
      const modelEvidence = { type: 'model', ok: true, provider: response.provider };
      evidence.push(modelEvidence);
      verificationPack.addEvidence('model', { provider: response.provider, costUsd: response.costUsd }, { source: response.provider });

      cycle.advance('observe');
      cycle.record({ provider: response.provider, toolResults: toolResults.map(({ tool, evidenceType }) => ({ tool, evidenceType })) }, { evidence: modelEvidence });
      workOrder.transition('verifying');
      cycle.advance('verify');

      const qualification = this.qualificationGate
        ? this.qualificationGate.evaluate(evidence)
        : route.requiresVerification
          ? { ok: false, missing: ['independent-verification'], failures: [] }
          : { ok: true, missing: [], failures: [] };

      cycle.record({ qualification }, { evidence: { type: 'qualification', ok: qualification.ok } });
      const packQualification = verificationPack.evaluate();
      const status = route.requiresVerification && (!qualification.ok || !packQualification.ok) ? 'verification-required' : 'completed';
      const claim = verificationPack.claim(`Engineering outcome for: ${input}`);

      if (status === 'completed') workOrder.transition('passed');
      else workOrder.transition('failed');

      cycle.advance('learn');
      cycle.record({ status, qualification, verification: packQualification });
      cycle.advance('preserve');
      const knowledgeState = route.requiresVerification && status === 'completed' ? 'verified' : 'inferred';
      cycle.preserve(`work-order:${workOrder.id}`, {
        goal: input,
        route,
        outcome: response.result,
        qualification,
        verification: packQualification,
      }, {
        state: knowledgeState,
        confidence: knowledgeState === 'verified' ? 1 : 0.6,
        evidence: verificationPack.snapshot().evidence,
        provenance: [{ type: 'work-order', id: workOrder.id }],
        ttlMs: knowledgeState === 'verified' ? Infinity : undefined,
      });

      if (task) this.ledger?.finish(task.id, { status: status === 'completed' ? 'passed' : 'failed', outcome: response.result, evidence });
      return {
        id: task?.id ?? crypto.randomUUID(), status, route, result: response.result, provider: response.provider,
        costUsd: response.costUsd, toolResults, evidence, qualification,
        workOrder: workOrder.snapshot(), verificationPack: verificationPack.snapshot(), verificationClaim: claim, cycle: cycle.snapshot(),
      };
    } catch (error) {
      this.knowledge.recordFailure(`${route.depth ?? 'unknown'}:${error.name}`, { goal: input, message: error.message, workOrderId: workOrder.id });
      workOrder.addAction({ type: 'execution.failed', message: error.message });
      if (workOrder.status === 'executing') workOrder.transition('halted');
      else if (workOrder.status === 'verifying') workOrder.transition('failed');
      if (task) this.ledger?.finish(task.id, { status: signal?.aborted ? 'cancelled' : 'failed', outcome: error.message, evidence });
      throw error;
    }
  }
}
