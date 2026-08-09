# HANDOFF: live working state

Where we left off, for the next agent (any agent, any day). Standing rules live in the repo's
agent-instruction files, not here. Keep this short and current.

_2026-08-09 · by: pi · main @ `91c3391` (dirty: local untracked paths)_

## Current state
PRs #11 (pi-toolview) and #13 (pi-editor/statusline split) merged to main. Local main matches
origin/main. The former feature branches were deleted locally and remotely.

## Next up
- Decide version bumps and publish tags for pi-toolview, pi-editor, and the breaking pi-statusline split.
- Run the per-package canonical checks before publishing: `npm pack --dry-run`.

## Open threads
- Untracked local work remains untouched: `.empanel/`, `docs/subagents-proposal.md`,
  `docs/subagents-research.md`, and `packages/pi-subagents/`.
- Shared docs still need a focused pass to add pi-toolview and pi-editor to architecture/install indexes.

## Gotchas
- Toolview forces existing blocks to redraw by flipping `setToolsExpanded` off and back on. Setting
  it to its current value is a Pi no-op.
