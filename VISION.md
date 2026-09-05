# Cortex Vision

## Product identity

Cortex is an AI-native, systems-aware software engineering environment and the integrated developer control surface for the Cannon ecosystem.

Its ambition is broader than an AI code editor. Cortex should understand engineering work across source, symbols, dependencies, builds, tests, runtime, memory, data, infrastructure, deployment, production behavior, evidence, and recovery.

## Primary comparison set

Cortex is our answer to lessons drawn from:

- VS Code
- Cursor
- JetBrains IDEs
- Zed-class performance and agent ideas where relevant

Cortex should preserve the extensibility and accessibility of modern editors, the deep code intelligence of full IDEs, and the productivity of AI coding environments while going beyond file-centric assistance toward whole-system engineering understanding.

## Strengths to preserve

- Excellent editing/workspace fundamentals.
- Deep language intelligence.
- Debugging and runtime inspection.
- Terminal and development tooling integration.
- AI assistance and agent workflows.
- Model independence and provider flexibility.
- Systems-aware reasoning across source, build, runtime, deployment, and production behavior.
- Evidence-backed engineering task execution.
- Security boundaries separating untrusted content from execution authority.
- Recovery and durable local/project state.
- Extensibility and integration with non-Cannon environments where the product vision supports it.

## Weaknesses to eliminate

- AI that merely reads files and guesses at the system;
- editor intelligence disconnected from build/runtime/deployment truth;
- agents receiving excessive authority by default;
- prompt/tool injection turning untrusted content into commands;
- duplicated parsing/indexing when an authoritative subsystem already exposes machine-readable facts;
- mandatory dependence on a single model vendor;
- opaque autonomous changes without evidence, provenance, or recovery.

## Independent ceiling

Cortex must be capable of succeeding as a premium engineering environment in its own right. The Cannon ecosystem should provide its deepest first-party integration, but Cortex must not be reduced to a UI shell for those sibling products.

## Ecosystem role

Cortex consumes and correlates authoritative information from Scout, Cannon/Cannon+, Nova, Parallel, Plasma, Cadence, Sprout, Velocity, and Chronos. It may build higher-level System Graph intelligence and operational understanding from those facts, while the originating product remains the authority for its own domain.

## Architectural invariant

**Cortex remains an AI-native systems-aware IDE and engineering environment, not merely a Cannon dashboard and not the canonical owner of compiler, runtime, framework, build, or deployment truth. Its competitive advantage should come from understanding and operating the whole engineering system with evidence and bounded authority.**
