# Cortex Production Qualification Ledger

This document is intentionally conservative. `PASS` means exercised by executable evidence. `UNVERIFIED` means the capability is specified or partially implemented but lacks production-grade proof. Cortex must not be called production qualified while any launch BLOCKER remains.

## Repository truth

The current repository began as a compact JavaScript architectural prototype. Existing verified concepts include workspace/document editing, LSP client integration, diagnostics, symbol graph, process-backed terminal/Git/debugging, provenance, ecosystem panels, Cannon+ memory inspection abstractions, AI edit review gating, and release-controller integration tests.

The system-aware foundation adds a Cortex System Graph, deny-by-default capability security, prompt/secret boundaries, model routing/failover, engineering task graphs, agent evidence ledger, qualification gates, integrity-checked atomic persistence, project memory, recovery journals, premium entitlements/usage metering, and structured metrics/tracing/logging.

The current closure tranche also implements automatic repository-to-System-Graph ingestion for JavaScript/TypeScript-family workspaces. It walks real workspace files, excludes build/vendor directories, fingerprints file content, records package metadata and dependency declarations, extracts ESM/CommonJS/dynamic module references, resolves internal imports, and attaches provenance to derived graph facts.

## Closure audit

| Severity | Area | Status | Finding / gate |
|---|---|---|---|
| BLOCKER | Desktop UI/workbench | UNVERIFIED | No complete desktop IDE shell/editor workbench exists yet. |
| BLOCKER | Packaging/install/update | UNVERIFIED | No signed Windows/macOS/Linux desktop distribution or updater/rollback proof. |
| BLOCKER | Full IDE workflows | UNVERIFIED | Search, splits, settings, keymaps, test explorer, package/toolchain UI, remote development and extension host are not complete products. |
| BLOCKER | Real authentication/billing | UNVERIFIED | Entitlement domain exists; identity, checkout, invoices, webhooks, durable subscription persistence and account lifecycle are not integrated. |
| CRITICAL | Agent sandbox | UNVERIFIED | Capability policy exists; OS/container sandbox enforcement is not yet integrated. |
| CRITICAL | Prompt injection | PARTIAL | Repository content is classified as data and suspicious patterns can be identified; adversarial end-to-end agent tests remain required. |
| CRITICAL | Durable state | PARTIAL | Integrity-checked atomic local state exists; database-backed team/cloud state, migrations, backup/restore and concurrency controls remain. |
| CRITICAL | System Graph | PARTIAL | Automatic source/package/import ingestion is implemented and tested. Language-semantic, runtime, Git-history, test, infra and deployment ingestion still remain before production qualification. |
| HIGH | Model Fabric | PARTIAL | Provider abstraction and failover exist; production adapters, timeouts, rate limits, streaming, cost budgets and malformed-response contracts remain. |
| HIGH | Observability | PARTIAL | Metrics, traces and redacted structured logging exist; exporters, dashboards, crash reporting and SLOs remain. |
| HIGH | Recovery | PARTIAL | Recovery journal exists; unsaved-buffer/session restoration and crash/fault tests remain. |
| HIGH | Performance | UNVERIFIED | 10K/100K/1M file, startup, typing, indexing, memory and AI latency benchmarks remain. |
| HIGH | Extension compatibility | UNVERIFIED | VS Code compatibility strategy remains an architectural experiment. |
| HIGH | Remote execution | UNVERIFIED | SSH/container/VM/cloud workspace implementation remains. |
| MEDIUM | Cost controls | PARTIAL | Usage metering exists; provider budgets, caching and account quotas remain. |
| MEDIUM | Privacy | PARTIAL | Secret boundary and logging redaction exist; data export/deletion/retention and hosted-processing controls remain. |
| MEDIUM | Documentation | PARTIAL | README, authoritative architecture and qualification ledger exist; user/admin/API/runbook docs remain. |

## Executable evidence

`npm run check` performs JavaScript syntax validation plus the deterministic local Node test suite.

Platform evidence verifies:

- cross-layer graph traversal and snapshot restore;
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
- ESM, re-export, dynamic-import and CommonJS module-specifier extraction.

Existing integration workflows continue to exercise real ecosystem process boundaries against first-party repositories rather than replacing those contracts with mocks.

## Independent qualification state

Installation/dependency integrity: PARTIAL — dependency-free Node package installs trivially, desktop installation does not yet exist.

Syntax checking: PASS when `npm run check:syntax` succeeds in CI.

Unit/integration tests: PASS only when `npm test` and the dedicated ecosystem proof workflows succeed on the candidate commit.

Authentication, billing provider, hosted persistence, migrations, backup/restore, desktop E2E, load, security sandbox, deployment packages, updater and rollback: UNVERIFIED.

## Launch gate

**NOT PRODUCTION QUALIFIED.** The foundation is materially stronger, but launch remains blocked by the desktop product, real commercial account/billing integration, OS-enforced agent sandbox, full persistence/cloud architecture, packaging/update/recovery, performance qualification, and end-to-end adversarial verification.

No future change may convert an `UNVERIFIED` requirement into `PASS` without executable or externally inspectable evidence.
