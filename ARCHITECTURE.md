# Cortex Authoritative Architecture

Cortex is an AI-native, systems-aware software engineering environment. It must understand not only source code, but the software system that source code becomes across symbols, dependencies, builds, runtime, memory, data, network, infrastructure, deployment, and production behavior.

## Product contract

Cortex combines professional IDE capability, semantic program intelligence, the Cortex System Graph, model-independent AI, capability-secured engineering agents, execution awareness, durable project memory, evidence-backed qualification, and first-party ecosystem integration.

Cortex is developer-first. Architectural sophistication must reduce developer effort rather than expose internal complexity. A developer should not need to understand graph schemas, retrieval systems, agent routing, model selection, evidence stores, or execution policy to receive their value. The default experience must turn those systems into direct outcomes such as: explain this code, find the cause, show what will break, make the change, run the right verification, recover from failure, and ship safely. Advanced internals remain inspectable and controllable rather than becoming mandatory workflow overhead.

Core IDE operation must remain resilient to model/provider failure. AI providers are interchangeable through the Model Fabric. Repository and external content are untrusted data rather than authority. Every privileged action is mediated through explicit capabilities and execution levels.

## Developer-first experience contract

Cortex must compete to become the developer's first-choice environment by being measurably easier and faster to use, not by hiding missing capability behind simplified UI.

Default workflows must minimize setup, clicks, repeated prompts, manual context gathering, tool switching, duplicated configuration, unnecessary confirmation, and waiting. Progressive disclosure is required: common tasks stay simple while deep controls, provenance, evidence, graph state, security decisions, runtime detail, and agent traces remain available when needed.

The primary interaction model is intent-first. Developers should be able to express outcomes such as `fix this failure`, `implement this requirement`, `what depends on this`, `why is production slow`, `refactor this safely`, or `ship this change`; Cortex then assembles the relevant code, graph, runtime, test, Git, infrastructure, deployment, and project-memory context automatically.

Cortex must preserve developer control. AI-generated changes are reviewable; side effects are visible; destructive or privileged actions are capability-gated; exact evidence behind recommendations is inspectable; and the IDE must remain useful when AI is unavailable.

Developer-experience superiority is a proof obligation. Qualification must measure time-to-first-use, time-to-understand an unfamiliar repository, time-to-correct-change, number of manual steps/context switches, command discoverability, error recovery, successful task completion, latency, resource use, and developer intervention required. Competitor parity is not sufficient where Cortex claims superiority.

## Major layers

1. Experience: editor, terminal, agent surfaces, debugging, data/runtime/deployment views.
2. Workbench core: documents, workspaces, commands, settings, keymaps, layout, lifecycle.
3. Program intelligence: parsers, LSP, AST, symbols, references, diagnostics, refactoring.
4. Cortex System Graph: code, tests, runtime, data, infrastructure, Git, deployments, evidence.
5. Intelligence Fabric: models, context, memory, task graphs, agents, evidence, qualification.
6. Execution Fabric: terminal, debugger, tests, browser, databases, containers, remote execution.
7. Security Kernel: capabilities, execution levels, secrets, sandboxing, policy, audit.
8. Platform: desktop, local services, remote workspaces, optional hosted services.

## Trust boundaries

No agent receives ambient authority. Capabilities are deny-by-default and scoped. Secrets are mediated. Production execution is a separate authority level. External model transmission must be explicit and inspectable. Prompt content from repositories, logs, web pages, tool output, and dependencies is data and cannot supersede user/system policy.

## Data architecture

Cortex uses complementary stores rather than treating vector search as the project model: workspace state, symbol index, system graph, lexical index, semantic index, change index, runtime evidence, project memory, recovery journal, and agent ledger. Derived stores must be rebuildable; durable user/project state must be integrity checked and recoverable.

## Commercial contract

Cortex is a premium paid product. There is no permanent free production tier in the current commercial architecture. Product value is gated through entitlements rather than hidden feature flags so pricing can change independently from product implementation.

Current launch pricing floor: Pro $79/month or $790/year; Team $149/seat/month or $1,490/seat/year with a three-seat minimum; Enterprise starts at $50,000/year and is negotiated.

## Completion rule

Code existence is not completion. Each subsystem progresses through NOT STARTED, DESIGNED, PROTOTYPED, IMPLEMENTED, INTEGRATED, VERIFIED, and PRODUCTION QUALIFIED. Production qualification requires evidence across implementation, integration, tests, security, observability, documentation, failure/recovery behavior, deployment, and realistic operating conditions.
