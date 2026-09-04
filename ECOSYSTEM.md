# Cortex ecosystem role

Cortex is the AI-native, systems-aware IDE and engineering environment over the Cannon developer ecosystem: the ecosystem's answer to a VS Code/Cursor-class development surface, while extending beyond text editing into whole-system understanding.

## Intent

Cortex should let a developer understand and operate the lifecycle from source through symbols, dependencies, builds, tests, runtime, memory, data, infrastructure, deployment and production behavior. It owns the integrated developer experience and System Graph, not the underlying language/runtime/framework responsibilities.

## First-party ecosystem integration

- Scout: structured configuration/document editing, diagnostics and language tooling.
- Cannon/Cannon+: language editing and engineering workflows.
- Nova: compiler diagnostics, symbols, inference, source spans, provenance and machine-readable output.
- Parallel: runtime execution, debugging and runtime inspection.
- Plasma: cross-language/native boundary diagnostics.
- Cadence: backend/web application development.
- Sprout: UI development and future visual tooling.
- Velocity: project creation, dev server, previews and target orchestration.
- Chronos: remote builds, artifacts, releases, deployment evidence and rollback controls.

Cortex should integrate these through explicit contracts while each sibling remains independently versioned, tested and releasable.

## Product boundary

Cortex is not the compiler, runtime, framework or deployment cloud. It is the place where those systems become understandable and operable together. Its broader systems-aware design may also support non-Cannon projects; first-party Cannon integration should prove the architecture without creating ecosystem lock-in.

## Engineering rule

Integration claims require real sibling-repository process tests rather than mocks. The existing ecosystem vertical proof is the correct direction: IMPLEMENT, INTEGRATE, TEST, SECURE, OBSERVE, DOCUMENT and VERIFY.
