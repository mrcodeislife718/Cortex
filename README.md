# Cortex

Cortex is an AI-native, systems-aware software engineering environment. Its design target is broader than an AI code editor: Cortex maintains an evidence-backed model of the software lifecycle across source, symbols, dependencies, builds, tests, runtime, memory, data, infrastructure, deployment, and production behavior.

Cortex is also the integrated IDE/control surface for the Cannon developer ecosystem: the role normally occupied by VS Code/Cursor-class tooling, but extended into whole-system understanding rather than text editing alone.

## Current repository status

Cortex is under active construction and is **not yet production qualified**. The repository contains verified platform foundations and real ecosystem integration proofs, while the remaining launch blockers are tracked conservatively in [`PRODUCTION_QUALIFICATION.md`](./PRODUCTION_QUALIFICATION.md). Nothing is described as complete merely because code exists.

## Implemented foundation

- workspace and text-document primitives;
- language-client, diagnostics, symbol, terminal, Git, debugger, provenance, memory-inspection, and release-control abstractions;
- process-backed ecosystem integrations exercised against real sibling repositories in CI;
- Cortex System Graph for cross-layer engineering relationships;
- deny-by-default capability security and execution authority levels;
- secret and prompt-injection trust boundaries;
- model-independent provider routing and failover;
- engineering task graphs, evidence requirements, and agent ledger;
- integrity-checked atomic local persistence, project memory, and recovery journal;
- premium commercial plans, entitlements, and usage metering;
- metrics, tracing, and redacted structured logging.

## Cannon developer ecosystem

Cortex integrates the first-party stack without absorbing the responsibilities of the individual systems:

- **Scout** — structured configuration/document editing, diagnostics, and language tooling;
- **Cannon / Cannon+** — first-party programming languages;
- **Nova** — compiler diagnostics, symbols, inference, source spans, provenance, and machine-readable compiler output;
- **Parallel** — runtime execution, debugging, and runtime inspection;
- **Plasma** — foreign/native boundary diagnostics and interop visibility;
- **Cadence** — backend/web application development;
- **Sprout** — UI application development;
- **Velocity** — project creation, dev server, previews, local builds, devices, and target orchestration;
- **Chronos** — remote builds, artifacts, releases, deployment evidence, updates, and rollback controls.

Each sibling remains independently versioned, tested, and releasable. Cortex is the place where the stack becomes understandable and operable together.

See [`ECOSYSTEM.md`](./ECOSYSTEM.md) for the explicit integration boundary.

## Architecture

The authoritative architecture is documented in [`ARCHITECTURE.md`](./ARCHITECTURE.md). Cortex is organized around eight logical layers: experience, workbench core, program intelligence, System Graph, Intelligence Fabric, Execution Fabric, Security Kernel, and platform/runtime services.

The architecture deliberately separates durable truth from derived indexes. Repository text, logs, dependency content, browser content, and tool output are untrusted data rather than agent authority. Privileged actions require explicit capabilities.

## Verification

Local qualification:

```sh
npm run check
```

This performs syntax validation and the deterministic local test suite on supported Node versions.

Real ecosystem process qualification is intentionally separate from local unit/integration qualification because it requires the Scout, Nova, Cannon, Cannon+, Velocity, and Chronos repositories:

```sh
SCOUT_REPO=/path/to/Scout \
NOVA_REPO=/path/to/Nova \
CANNON_REPO=/path/to/Cannon \
CANNON_PLUS_REPO=/path/to/Cannon-Plus \
VELOCITY_REPO=/path/to/Velocity \
CHRONOS_REPO=/path/to/Chronos \
npm run test:ecosystem
```

GitHub Actions also runs the broader `Ecosystem Vertical Proof` against the real first-party repositories. Tests are not replaced with mocks to make qualification pass.

## Engineering contract

Every production tranche must **IMPLEMENT, INTEGRATE, TEST, SECURE, OBSERVE, DOCUMENT, and VERIFY** its capability. No placeholder implementation, fake persistence, silent success path, disabled qualification, or unverified production claim is acceptable.

Subsystem status progresses through:

`NOT STARTED → DESIGNED → PROTOTYPED → IMPLEMENTED → INTEGRATED → VERIFIED → PRODUCTION QUALIFIED`

See [`PRODUCTION_QUALIFICATION.md`](./PRODUCTION_QUALIFICATION.md) for the current evidence ledger and launch blockers, and [`ROADMAP.md`](./ROADMAP.md) for product direction.

## Commercial model

Cortex is designed as a premium paid engineering product. The current commercial architecture has no permanent free production tier. Pricing and entitlements are implemented separately so commercial packaging can evolve without coupling pricing decisions to core IDE architecture.

## Runtime

The current platform foundation requires Node.js 20 or newer. CI qualifies Node.js 22 and 24. Desktop runtime and packaging choices remain subject to production qualification and are not represented here as completed work.

## License

MIT, as currently declared by the repository package metadata.
