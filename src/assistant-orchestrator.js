export const AssistanceDepth = Object.freeze({
  INLINE: 'inline',
  EXPLAIN: 'explain',
  CHANGE: 'change',
  ENGINEER: 'engineer',
});

export class AssistantOrchestrator {
  constructor({ graph = null, taskGraphFactory = null } = {}) {
    this.graph = graph;
    this.taskGraphFactory = taskGraphFactory;
  }

  classifyIntent(input, context = {}) {
    if (!input || typeof input !== 'string') throw new TypeError('assistant input must be text');
    const text = input.trim();
    const lower = text.toLowerCase();

    const highRisk = /\b(deploy|production|database|migration|infra|infrastructure|rollback|release|ship)\b/.test(lower);
    const multiStep = /\b(implement|build|migrate|refactor|fix everything|set up|setup|create the database|why did production fail|research the best approach)\b/.test(lower);
    const change = /\b(fix|change|edit|rename|write|add|remove|update|test)\b/.test(lower);
    const explanation = /\b(explain|why|what|how|show me|understand)\b/.test(lower);

    let depth = AssistanceDepth.INLINE;
    if (explanation) depth = AssistanceDepth.EXPLAIN;
    if (change) depth = AssistanceDepth.CHANGE;
    if (multiStep || highRisk) depth = AssistanceDepth.ENGINEER;

    return {
      input: text,
      depth,
      requiresPlan: depth === AssistanceDepth.ENGINEER,
      requiresVerification: depth === AssistanceDepth.CHANGE || depth === AssistanceDepth.ENGINEER,
      requiresApproval: highRisk || Boolean(context.requiresApproval),
      contextSources: this.#contextSources(depth, lower),
    };
  }

  route(input, context = {}) {
    const intent = this.classifyIntent(input, context);
    const agents = new Set();
    const tools = new Set();

    if (/debug|fail|error|slow|latency|crash/.test(intent.input.toLowerCase())) agents.add('debugger');
    if (/test|verify|qualification/.test(intent.input.toLowerCase()) || intent.requiresVerification) agents.add('test-engineer');
    if (/security|auth|permission|secret/.test(intent.input.toLowerCase())) agents.add('security-engineer');
    if (/architecture|design|best approach|refactor/.test(intent.input.toLowerCase())) agents.add('architect');
    if (/deploy|production|release|ship/.test(intent.input.toLowerCase())) agents.add('release-engineer');
    if (/database|schema|migration/.test(intent.input.toLowerCase())) tools.add('database');
    if (/research|library|documentation|docs/.test(intent.input.toLowerCase())) tools.add('research');
    if (intent.depth === AssistanceDepth.CHANGE || intent.depth === AssistanceDepth.ENGINEER) agents.add('implementation-agent');

    tools.add('workspace');
    if (intent.depth === AssistanceDepth.ENGINEER) tools.add('terminal');

    return { ...intent, agents: [...agents], tools: [...tools] };
  }

  #contextSources(depth, lower) {
    const sources = new Set(['current-editor']);
    if (depth !== AssistanceDepth.INLINE) sources.add('system-graph');
    if (depth === AssistanceDepth.CHANGE || depth === AssistanceDepth.ENGINEER) sources.add('project-memory');
    if (/production|slow|latency|crash|runtime/.test(lower)) sources.add('runtime-evidence');
    if (/deploy|production|release|ship/.test(lower)) sources.add('deployment-state');
    if (/history|regression|yesterday|commit|change/.test(lower)) sources.add('git-history');
    return [...sources];
  }
}
