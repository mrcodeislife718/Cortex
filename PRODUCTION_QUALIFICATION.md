# Cortex Production Qualification Ledger

This ledger is intentionally conservative. `PASS` means the named property has executable repository evidence on a qualifying commit. `PARTIAL` means meaningful production implementation exists but an important integration, external dependency, operating-system boundary, scale target, or live-service proof remains. `UNVERIFIED` means the repository does not yet contain sufficient evidence. A usable desktop build does not by itself mean the complete commercial service is production qualified.

## Repository truth

Cortex is now a native desktop IDE built with Tauri 2, Rust services, Monaco, and Cortex-owned engineering/runtime services rather than an Electron or VS Code fork. The workbench provides folder opening, Explorer CRUD, multi-tab editing, split editors, save/recovery, workspace search, Git status/diff/stage/unstage/commit, project task discovery/execution, a native PTY terminal, LSP-backed language intelligence, DAP debugging, command palette/settings/themes, live diagnostics, update integration, commercial activation, and the Cortex assistant surface.

The platform layer contains the Cortex System Graph, repository ingestion, language/runtime/Git/test/infrastructure/deployment evidence ingestors, deny-by-default capability security, prompt/secret boundaries, assistant orchestration, model routing/failover, engineering tools/evidence, agent sandboxing, extension process isolation and package verification, persistence/recovery, PostgreSQL state, commercial identity/billing/activation, cost controls, privacy controls, telemetry exporters, update verification/rollback, remote execution adapters, and performance/dead-weight qualification.

Desktop dependency resolution is reproducible through committed npm `package-lock.json` and Rust `Cargo.lock`. Desktop qualification uses `npm ci`, `cargo check --locked`, cached Rust build state, and real Tauri installer builds across Linux, Windows, and macOS.

## Closure audit

| Severity | Area | Status | Repository-backed boundary |
|---|---|---|---|
| BLOCKER | Desktop UI/workbench | PASS | Native Tauri/Monaco workbench builds and packages; core editing, Explorer, search, Git, task, terminal, debugging, settings, recovery and Problems workflows are implemented. |
| HIGH | Packaging/install | PASS | Desktop Qualification builds Linux `.deb`/AppImage, Windows MSI/NSIS and macOS DMG artifacts. |
| HIGH | Commercial signing/notarization | PARTIAL | Updater signing hooks and bundle configuration exist; Apple notarization and Windows trust-chain proof require real external signing authorities/credentials. |
| HIGH | Full IDE workflows | PARTIAL | Core daily development is usable. A fully integrated desktop extension manager, broader test explorer/toolchain UI and remote-development UX remain below the target product depth. |
| HIGH | Authentication/billing | PARTIAL | OIDC PKCE/JWKS verification, signed sessions, Stripe checkout/portal/webhook verification, durable subscriptions, activation codes and entitlements are implemented/tested; live production deployment with owned provider credentials remains external evidence. |
| CRITICAL | Agent sandbox | PASS | Docker/Podman qualification exercises no-new-privileges, capability dropping, resource limits, read-only rootfs/workspace defaults and network-deny defaults. |
| CRITICAL | Extension sandbox | PARTIAL | Extensions have capability policy, process isolation, time/output/memory budgets, quarantine, signed-package verification and transactional rollback. Arbitrary third-party extensions do not yet have a proven OS-level filesystem/network sandbox equivalent to the agent sandbox. |
| CRITICAL | Prompt/secret boundary | PASS | Repository/tool content is treated as untrusted data, secrets are excluded from automatic model context, context release policies reject secret-shaped data, and adversarial tests exercise injection boundaries. |
| CRITICAL | Durable state | PASS | PostgreSQL qualification exercises migrations, persistence, optimistic concurrency and backup/restore/rollback paths; local integrity-checked state remains available for desktop/session state. |
| CRITICAL | System Graph | PARTIAL | Source/package/import ingestion plus language semantic, runtime, Git, test, infrastructure and deployment evidence ingestors are implemented/tested. Continuous live population of every evidence class from the desktop remains incomplete. |
| HIGH | Assistant orchestration | PARTIAL | Intent routing, approval boundaries, hosted model integration, bounded repository/editor/Git/diagnostic context and engineering-runtime tool/evidence infrastructure exist. The commercial desktop path does not yet expose the complete autonomous EngineeringRuntime tool loop to the user. |
| HIGH | Model Fabric | PASS | OpenAI/Anthropic/Gemini adapters, model independence, timeout/retry/backoff, circuit breaking, response validation, usage/cost accounting and per-request/monthly budgets are implemented/tested. Live-provider availability depends on configured provider credentials. |
| HIGH | Observability | PARTIAL | Metrics/tracing/redacted logs and telemetry exporters exist; production dashboards, crash-reporting service and operational SLO proof require deployed infrastructure. |
| HIGH | Recovery | PASS | Unsaved buffers/workspace sessions restore durably; model/provider failure isolation, LSP/DAP/PTY process isolation and transactional update rollback mechanisms are implemented. |
| HIGH | Performance | PARTIAL | Performance and dead-weight gates are executable and architecture superiority requires evidence. Full standardized 10K/100K/1M repository benchmark evidence is not yet complete. |
| HIGH | Extension compatibility | PARTIAL | VS Code manifest translation, native extension lifecycle/security, process isolation, signatures and transactional install/rollback exist. A production desktop manager/marketplace and broad third-party compatibility corpus remain. |
| HIGH | Remote execution | PARTIAL | Shell-free SSH and container execution adapters are implemented/tested. Integrated remote workspace UX, connection lifecycle and fault qualification remain. |
| MEDIUM | Cost controls | PASS | Provider pricing, usage metering, per-request budgets, plan-level monthly budgets and durable usage accounting are implemented/tested. |
| MEDIUM | Privacy | PASS | Secret boundaries, redaction, hosted-processing/context-release policy and privacy controls are implemented; jurisdiction-specific production policy remains deployment configuration. |
| MEDIUM | Documentation | PARTIAL | Architecture, superiority contract, repository docs and this qualification ledger exist; end-user/admin/commercial operations documentation still needs expansion. |

## Executable evidence

The repository qualification suite includes:

- Cortex CI and architecture-superiority contract validation;
- Portfolio Proof and ecosystem process qualification;
- Agent Sandbox Qualification;
- PostgreSQL State Qualification;
- Desktop Qualification on Linux, Windows and macOS;
- System Graph ingestion/traversal/evidence tests;
- assistant routing, adversarial prompt-boundary and model-provider tests;
- extension policy/process/package/signature/rollback tests;
- commercial runtime, OIDC/session/Stripe/activation/cost tests;
- persistence, recovery, update-signature/rollback, privacy and telemetry tests;
- remote execution command-spec tests;
- performance/dead-weight regression gates.

Desktop Qualification specifically requires the committed npm and Cargo lockfiles, uses `npm ci`, checks Rust with `cargo check --locked`, performs the web build, compiles the optimized native Tauri application and uploads installer artifacts.

## Independent qualification state

Installation/dependency integrity: **PASS** for repository dependency locks and qualified desktop installer generation.

Core syntax/unit/integration qualification: **PASS** only for commits where the required GitHub Actions lanes succeed on that exact commit.

Desktop daily-use readiness: **PASS for the implemented core workbench**, with the remaining product-depth items identified above rather than hidden behind a blanket desktop blocker.

Commercial production readiness: **PARTIAL**. Real service deployment, owned OIDC/Stripe/model/database credentials, external code-signing/notarization, production operational dashboards/SLOs, the complete extension marketplace/OS sandbox boundary, and broader scale evidence cannot be inferred from repository tests alone.

## Launch gate

**CORTEX DESKTOP IS USABLE AND PACKAGE-QUALIFIED; THE COMPLETE COMMERCIAL SERVICE IS NOT YET FULLY PRODUCTION QUALIFIED.**

The remaining launch boundaries are explicit: live commercial infrastructure/credentials, platform signing/notarization, OS-level third-party extension containment plus usable extension-manager/marketplace integration, deeper remote-development UX, full-scale performance evidence, and deployed operational verification.

No future change may convert a `PARTIAL` or `UNVERIFIED` requirement into `PASS` without executable or externally inspectable evidence.
