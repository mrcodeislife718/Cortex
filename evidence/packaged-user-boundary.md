# Packaged User-Boundary Proof

Cortex qualification crosses the user boundary only when a packaged build performs the action a developer performs and the expected persisted/runtime effect is inspected.

Examples: clicking Open Folder must produce a real native folder picker and Explorer population; typing into the terminal must reach the PTY and return shell output; saving must change repository bytes; staging must alter the Git index; a breakpoint must stop a real debug target; an AI change must alter a reviewable transaction and pass independent verification.

Headless compile/build checks remain valuable prerequisites but cannot substitute for these proofs.
