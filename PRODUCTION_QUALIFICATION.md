# Cortex Production Qualification Ledger

This document is intentionally conservative. `PASS` means exercised by executable evidence. `UNVERIFIED` means the capability is specified or partially implemented but lacks production-grade proof. Cortex must not be called production qualified while any launch BLOCKER remains.

## Repository truth

The current repository began as a compact JavaScript architectural prototype. Existing verified concepts include workspace/document editing, LSP client integration, diagnostics, symbol graph, process-backed terminal/Git/debugging, provenance, ecosystem panels, Cannon+ memory inspection abstractions, AI edit review gating, and release-controller integration tests.

The system-aware foundation adds a Cortex System Graph, deny-by-default capability security, prompt/secret boundaries, model routing/failover, engineering task graphs, agent evidence ledger, qualification gates, integrity-checked atomic persistence, project memory, recovery journals, premium entitlements/usage metering, and structured metrics/tracing/logging.

Automatic repository-to-System-Graph ingestion now walks JavaScript/TypeScript-family workspaces, excludes build/vendor directories, fingerprints file content, records package metadata and dependency declarations, extracts ESM/CommonJS/dynamic module references, resolves internal imports, and attaches provenance to derived graph facts.

The developer-first tranche adds a readable System Graph facade, intent-based Assistant Orchestrator, and native Extension Platform foundation. The assistant selects assistance depth without forcing user-facing Ask/Plan/Agent/Debug modes. Native extension manifests declare runtime, activation events, capabilities and execution level; activation integrates with the Security Kernel; runtime mismatches are denied; health is inspectable; repeated activation failures quarantine the extension.

## Closure audit

| Severity | Area | Status | Finding / gate |
|---|---|---|---|
| BLOCKER | Desktop UI/workbench | UNVERIFIED | No complete desktop IDE shell/editor workbench exists yet. The VS Code-familiar workbench contract is now explicit. |
| BLOCKER | Packaging/install/update | UNVERIFIED | No signed Windows/macOS/Linux desktop distribution or updater/rollback proof. |
| BLOCKER | Full IDE workflows | UNVERIFIED | Search, splits, settings, keymaps, test explorer, package/toolchain UI and remote development are not complete products. |
| BLOCKER | Real authentication/billing | UNVERIFIED | Entitlement domain exists; identity, checkout, invoices, webhooks, durable subscription persistence and account lifecycle are not integrated. |
| CRITICAL | Agent sandbox | UNVERIFIED | Capability policy exists; OS/container sandbox enforcement is not yet integrated. |
| CRITICAL | Extension sandbox | UNVERIFIED | Extension capabilities/runtime declarations are enforced at policy level; process/OS sandbox enforcement is still required. |
| CRITICAL | Prompt injection | PARTIAL | Repository content is classified as data and suspicious patterns can be identified; adversarial end-to-end agent tests remain required. |
| CRITICAL | Durable state | PARTIAL | Integrity-checked atomic local state exists; database-backed team/cloud state, migrations, backup/restore and concurrency controls remain. |
| CRITICAL | System Graph | PARTIAL | Automatic source/package/import ingestion and developer-facing graph queries are implemented/tested. Language-semantic, runtime, Git-history, test, infra and deployment ingestion remain. |
| HIGH | Assistant orchestration | PARTIAL | Intent classification, automatic depth selection, context-source selection and specialist routing are tested. Real tool execution, model integration, cancellation, recovery and end-to-end qualification remain. |
| HIGH | Model Fabric | PARTIAL | Provider abstraction and failover exist; production adapters, timeouts, rate limits, streaming, cost budgets and malformed-response contracts remain. |
| HIGH | Observability | PARTIAL | Metrics, traces and redacted structured logging exist; exporters, dashboards, crash reporting and SLOs remain. |
| HIGH | Recovery | PARTIAL | Recovery journal exists; unsaved-buffer/session restoration and crash/fault tests remain. |
| HIGH | Performance | UNVERIFIED | 10K/100K/1M file, startup, typing, indexing, memory, extension and AI latency benchmarks remain. |
| HIGH | Extension compatibility | PARTIAL | Native extension lifecycle/security foundation exists. Real VS Code API compatibility, marketplace ingestion, third-party extension corpus tests, process isolation, transactional upgrade/rollback and resource accounting remain. |
| HIGH | Remote execution | UNVERIFIED | SSH/container/VM/cloud workspace implementation remains. |
| MEDIUM | Cost controls | PARTIAL | Usage metering exists; provider budgets, caching and account quotas remain. |
| MEDIUM | Privacy | PARTIAL | Secret boundary and logging redaction exist; data export/deletion/retention and hosted-processing controls remain. |
| MEDIUM | Documentation | PARTIAL | README, authoritative architecture and qualification ledger exist; user/admin/API/runbook docs remain. |

## Executable evidence

`npm run check` performs JavaScript syntax validation plus the deterministic local Node test suite.

Platform evidence verifies:

- cross-layer graph traversal and snapshot restore;
- developer-facing project overview, dependency/dependent and impact-query contracts;
- capability denial and privilege-escalation denial;
- secret access denial without authority;
- repository prompt content treated as data;
- model-provider failover;
- engineering task evidence requirements;
- agent event/evidence ledger behavior;
- atomic project-memory persistence and recovery checkpoints;
- absence of a free production plan and premium entitlement enforcement;
- metrics, tracing and sensitive-field redaction;
- real temporary-workspace ingestion of files, hashes, package declarations, internal imports, external dependencies and provenance;
- exclusion of `node_modules` from graph ingestion;
- ESM, re-export, dynamic-import and CommonJS module-specifier extraction;
- automatic assistant escalation from explanation/change requests to full engineering depth for high-risk or multi-step work;
- assistant selection of runtime/deployment/Git context for production-failure investigation;
- lazy extension activation from declared events;
- extension capability denial without an authorized Security Kernel token;
- extension runtime-class enforcement;
- extension health accounting and automatic quarantine after repeated failures.

Existing integration workflows continue to exercise real ecosystem process boundaries against first-party repositories rather than replacing those contracts with mocks.

## Independent qualification state

Installation/dependency integrity: PARTIAL — dependency-free Node package installs trivially, desktop installation does not yet exist.

Syntax checking: PASS when `npm run check:syntax` succeeds in CI.

Unit/integration tests: PASS only when `npm test` and the dedicated ecosystem proof workflows succeed on the candidate commit.

Authentication, billing provider, hosted persistence, migrations, backup/restore, desktop E2E, load, OS-level agent/extension sandboxing, deployment packages, updater and rollback: UNVERIFIED.

## Launch gate

**NOT PRODUCTION QUALIFIED.** The foundation is materially stronger, but launch remains blocked by the desktop product, real commercial account/billing integration, OS-enforced agent and extension sandboxing, full persistence/cloud architecture, packaging/update/recovery, performance qualification, real extension compatibility evidence, and end-to-end adversarial verification.

No future change may convert an `UNVERIFIED` requirement into `PASS` without executable or externally inspectable evidence.
