# Packaged Workbench Interaction Contract

Cortex desktop qualification must prove behavior across the user boundary, not only compilation or process survival.

The packaged application must exercise these paths on the exact head commit: open-folder dialog -> native workspace state -> Explorer population; Explorer file click -> native read -> Monaco model -> edit -> native write -> persisted bytes; search query -> native workspace search -> navigable result; source control -> native Git status/diff/stage/commit; project task discovery -> execution -> output; terminal tab -> PTY allocation -> input -> output -> resize -> stop; command palette -> routed command; settings -> live editor option change; session snapshot -> restart -> restore; language service -> diagnostics/navigation; debugger -> DAP lifecycle; extension surface -> capability assessment/lifecycle; assistant -> bounded context and explicit unavailable state when hosted runtime is not configured.

A subsystem failure must be visible and localized. It may mark that subsystem failed or degraded, but it must not silently leave a dead-looking control or destroy editor state.

Qualification evidence should include the exact commit SHA, platform, package type, user action, native command or protocol crossed, expected observable result, actual observable result, and PASS/FAIL. A startup timeout alone is insufficient evidence for an interactive feature.
