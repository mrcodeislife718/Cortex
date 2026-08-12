# Cortex Roadmap

Cortex is the first-party IDE for Scout, Cannon, Cannon+, and the full platform.

## Product contract

Cortex owns editing, project navigation, terminal integration, debugging, profiling, refactoring, AI assistance, Nova diagnostics, Infer visualization, Cannon+ memory inspection, Syncio data exploration, Sprout previews, Cadence route inspection, Velocity device workflows, Chronos deployment views, and Plasma boundary debugging.

## Design sources

Cortex combines VS Code extensibility and responsiveness, Cursor-style codebase-aware AI workflows, and IntelliJ-grade semantic navigation/refactoring while avoiding extension dependency chaos, cloud-only intelligence, and excessive baseline resource use.

## Implementation order

1. Editor shell and project model.
2. Scout/Cannon language-server integration.
3. Nova structured diagnostics and symbol graph.
4. Debugger and provenance views.
5. Git and terminal workflows.
6. Sprout/Syncio/Cadence development panels.
7. Cannon+ memory inspector.
8. Local-first AI assistance with optional model providers.
9. Velocity and Chronos release/deploy workflows.

## Proof gates

Editor features require integration tests against real Scout/Cannon projects. Refactors must preserve builds/tests. Diagnostics must map exactly to Nova source locations. AI edits must remain reviewable and never silently bypass compiler checks.

## Commercial boundary

Cortex can monetize through Pro AI features, team collaboration, remote workspaces, enterprise policy/SSO/audit, private model hosting, advanced debugging/profiling, and support while keeping a useful core editor accessible.
