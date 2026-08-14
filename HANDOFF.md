# HANDOFF: live working state

Where we left off, for the next agent (any agent, any day). Standing rules live in the repo's
agent-instruction files, not here. Keep this short and current.

_2026-08-15 · by: pi · main @ `0301753` (dirty: docs/ deleted locally, untracked pi-subagents WIP)_

## Current state
The npm scope moved from `@pi-extensions` to `@smarzban` (PR #16) and all four packages are
published under the new scope: pi-pacman 0.1.2, pi-statusline 0.2.0 (new t/s + ttft footer
segments, PR #15), pi-editor 0.1.0 (alt+s stash), pi-toolview 0.1.0. Old-scope packages carry
tombstone releases (`@pi-extensions/pi-pacman@0.1.3`, `@pi-extensions/pi-statusline@0.1.4`, the
latter identical to 0.1.3 with the box intact) that notify users in the TUI to migrate, plus npm
deprecation banners. CHANGELOG converted to dated per-release entries (PR #20).

## Next up
- Link Trusted Publisher on all four `@smarzban` npm packages (smarzban / pi-extensions /
  release.yml) if not yet done; until then tag releases build but cannot publish.
- Tag the new-scope releases for the record when desired: pi-statusline-v0.2.0 was deleted
  pre-rename and not yet re-tagged; editor/toolview/pacman first publishes were manual.
- Owner deleted `docs/` locally (intentional restructure in progress) - commit or finish that
  restructure; root README links into docs/ will dangle until then.
- Consider a `@smarzban/pi-extensions` meta-package (deps on all four, pi.extensions into
  node_modules) for one-line npm install of everything - discussed, parked.

## Open threads
- `packages/pi-subagents/` WIP is local-only and untracked (its package.json briefly landed on
  main in `dc98daf`, removed in #17; still in history, harmless).
- Old-scope `@pi-extensions/pi-statusline@0.2.0` was unpublished but the registry may still list
  it; harmless either way since `latest` points at the 0.1.4 tombstone.

## Gotchas
- Toolview forces existing blocks to redraw by flipping `setToolsExpanded` off and back on. Setting
  it to its current value is a Pi no-op.
- Agent process rules: merges and PR/issue comments only with the owner's explicit go-ahead; no
  direct pushes to main (protection flags admin bypass); beware globs like `packages/*/package.json`
  sweeping untracked WIP into commits.
