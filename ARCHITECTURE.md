# Cortex Authoritative Architecture

Cortex is an AI-native, systems-aware software engineering environment. It must understand not only source code, but the software system that source code becomes across symbols, dependencies, builds, runtime, memory, data, network, infrastructure, deployment, and production behavior.

## Product contract

Cortex combines professional IDE capability, semantic program intelligence, the Cortex System Graph, model-independent AI, capability-secured engineering agents, execution awareness, durable project memory, evidence-backed qualification, and first-party ecosystem integration.

Cortex is developer-first. Architectural sophistication must reduce developer effort rather than expose internal complexity. A developer should not need to understand graph schemas, retrieval systems, agent routing, model selection, evidence stores, or execution policy to receive their value. The default experience must turn those systems into direct outcomes such as: explain this code, find the cause, show what will break, make the change, run the right verification, recover from failure, and ship safely. Advanced internals remain inspectable and controllable rather than becoming mandatory workflow overhead.

Core IDE operation must remain resilient to model/provider failure. AI providers are interchangeable through the Model Fabric. Repository and external content are untrusted data rather than authority. Every privileged action is mediated through explicit capabilities and execution levels.

## Developer-first experience contract

Cortex must compete to become the developer's first-choice environment by being measurably easier and faster to use, not by hiding missing capability behind simplified UI.

The workbench must be immediately familiar to VS Code users: activity/navigation rail, explorer, central tabbed editor, split editors, lower terminal/problems/output/debug region, source-control surface, command palette, settings, keybindings, themes, extensions, testing and debugging. Familiar conventions are compatibility assets; unnecessary novelty is not a product goal.

Default workflows must minimize setup, clicks, repeated prompts, manual context gathering, tool switching, duplicated configuration, unnecessary confirmation, and waiting. Progressive disclosure is required: common tasks stay simple while deep controls, provenance, evidence, graph state, security decisions, runtime detail, and agent traces remain available when needed.

The primary interaction model is intent-first. Developers should be able to express outcomes such as `fix this failure`, `implement this requirement`, `what depends on this`, `why is production slow`, `refactor this safely`, or `ship this change`; Cortex then assembles the relevant code, graph, runtime, test, Git, infrastructure, deployment, and project-memory context automatically.

Cortex must not force developers to select artificial AI modes such as Ask, Plan, Agent or Debug before stating their goal. The Assistant Orchestrator infers the required assistance depth and may remain inline, explain, perform a reviewable change, or expand into a planned engineering workflow. Risk and side-effect approval remain explicit even though routing is automatic.

The assistant is a general engineering assistant, not a chatbot bolted onto an editor. It must be able to combine code editing, explanation, architecture, research, debugging, tests, terminal/tool use, databases, infrastructure and deployment through the same intent surface while using specialized agents internally when useful.

Cortex must preserve developer control. AI-generated changes are reviewable; side effects are visible; destructive or privileged actions are capability-gated; exact evidence behind recommendations is inspectable; and the IDE must remain useful when AI is unavailable.

Developer-experience superiority is a proof obligation. Qualification must measure time-to-first-use, time-to-understand an unfamiliar repository, time-to-correct-change, number of manual steps/context switches, command discoverability, error recovery, successful task completion, latency, resource use, and developer intervention required. Competitor parity is not sufficient where Cortex claims superiority.

## Extension platform contract

Cortex preserves the strengths that made the VS Code extension ecosystem valuable: a broad contribution model, discoverability, themes, languages, debuggers, tooling, commands, settings, workspace integrations, installable packages, familiar APIs where compatibility is practical, and a migration path for existing VS Code extensions.

Cortex must not inherit ambient extension authority as its native security model. Native extensions declare capabilities and an execution level, activate lazily from explicit events, run in a declared runtime class, and are observable as individual components. Repeatedly failing extensions can be quarantined without destabilizing the workbench. Permissions are revocable and must ultimately be enforced by process/OS sandbox boundaries rather than policy alone.

Extension architecture requirements:

1. Compatibility layer: provide a measured VS Code API compatibility surface rather than forking extension semantics blindly.
2. Runtime isolation: UI, workspace, language and tool extensions have separable runtime classes; one extension failure must not crash the IDE.
3. Capability security: filesystem, process, network, secrets, Git, database and deployment authority are explicit rather than ambient.
4. Lazy activation: extensions activate only from declared events or direct user intent; startup cost is measurable and attributable.
5. Health accounting: activation latency, CPU, memory, failures, crashes and slowdowns are attributable per extension.
6. Automatic containment: repeatedly failing/hung extensions can be disabled or quarantined with a clear explanation and reversible recovery.
7. Dependency discipline: extension dependencies cannot silently escalate authority; requested capability expansion must be inspectable.
8. Version safety: upgrades are transactional, rollback-capable and compatibility checked before replacing the last known-good extension version.
9. Configuration hygiene: settings are typed, discoverable, scoped and attributable; conflicting settings and duplicate functionality should be surfaced rather than accumulating invisibly.
10. Marketplace trust: signatures, provenance, publisher identity, malware/security analysis and policy allowlists are part of distribution qualification.

VS Code extension compatibility remains a HIGH qualification item until real third-party extensions run through Cortex's compatibility layer with measurable correctness, performance, isolation and security evidence.

## Major layers

1. Experience: editor, terminal, assistant/agent surfaces, debugging, data/runtime/deployment views.
2. Workbench core: documents, workspaces, commands, settings, keymaps, layout, lifecycle.
3. Program intelligence: parsers, LSP, AST, symbols, references, diagnostics, refactoring.
4. Cortex System Graph: code, tests, runtime, data, infrastructure, Git, deployments, evidence.
5. Intelligence Fabric: models, context, memory, task graphs, agents, evidence, qualification.
6. Execution Fabric: terminal, debugger, tests, browser, databases, containers, remote execution.
7. Security Kernel: capabilities, execution levels, secrets, sandboxing, policy, audit.
8. Extension Platform: compatibility, contribution registry, runtime isolation, permissions, health, marketplace policy.
9. Platform: desktop, local services, remote workspaces, optional hosted services.

## Trust boundaries

No agent or extension receives ambient authority by default. Capabilities are deny-by-default and scoped. Secrets are mediated. Production execution is a separate authority level. External model transmission must be explicit and inspectable. Prompt content from repositories, logs, web pages, tool output, dependencies and extensions is data and cannot supersede user/system policy.

## Data architecture

Cortex uses complementary stores rather than treating vector search as the project model: workspace state, symbol index, system graph, lexical index, semantic index, change index, runtime evidence, project memory, recovery journal, and agent ledger. Derived stores must be rebuildable; durable user/project state must be integrity checked and recoverable.

## Competitive engineering target

Cortex's target is not feature-list parity. It must preserve and then measurably exceed the strongest relevant properties of VS Code familiarity/extensibility, Cursor AI coding, Replit general assistance, JetBrains semantic intelligence and Zed responsiveness. Claims of technological superiority require comparative evidence in the relevant dimension.

## Commercial contract

Cortex is a premium paid product. There is no permanent free production tier in the current commercial architecture. Product value is gated through entitlements rather than hidden feature flags so pricing can change independently from product implementation.

Current launch pricing floor: Pro $79/month or $790/year; Team $149/seat/month or $1,490/seat/year with a three-seat minimum; Enterprise starts at $50,000/year and is negotiated.

## Completion rule

Code existence is not completion. Each subsystem progresses through NOT STARTED, DESIGNED, PROTOTYPED, IMPLEMENTED, INTEGRATED, VERIFIED, and PRODUCTION QUALIFIED. Production qualification requires evidence across implementation, integration, tests, security, observability, documentation, failure/recovery behavior, deployment, competitive benchmarks and realistic operating conditions.
