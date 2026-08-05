# HANDOFF.md

## Current State

**Branch**: `pi-stash` — rebased onto `pi-toolview`. Contains both features.

**Restructure done this session**: pi-statusline is now footer-only; the
rounded editor box moved out and merged with the draft stash into a new
`pi-editor` package. `pi-stash` package was deleted.

Three extensions now:
1. **pi-toolview** (`packages/pi-toolview/`) — compact tool output, PR #11 open on the `pi-toolview` branch
2. **pi-statusline** (`packages/pi-statusline/`) — footer only (model/effort, ctx, cost, provider usage, git/PR)
3. **pi-editor** (`packages/pi-editor/`) — rounded editor box + ctrl+s draft stash

User's live-test feedback (all applied): stash clears the editor; restore is
one-shot (stash entry deleted on restore).

## pi-editor (`packages/pi-editor/`)

Two editor-surface features:
- **Rounded box**: `╭─╮ │ › ` border with session name on the bottom border.
  Moved verbatim from old pi-statusline (StatuslineEditor → EditorBox).
  `/editor on|off|status`, persisted to `~/.pi/agent/editor.json`.
- **Draft stash**: `ctrl+s` with text → stash (per cwd) + clear editor;
  `ctrl+s` empty → restore (one-shot, entry deleted). `/stash`, `/stash clear`.
  Persisted to `~/.pi/agent/stash.json`.

**Verified facts (2026-08-05)**: extension shortcuts fire BEFORE app
keybindings in the editor; ctrl+s is bound to `app.session.toggleSort` and
`app.models.save` but neither is reserved, so the extension wins (benign
conflict warning in extensions list; remap those two built-ins to silence).
`appendEntry` has no read-back API, hence the own stash file.

## pi-statusline (`packages/pi-statusline/`)

Footer only now. Editor code removed: `applyEditor`, `StatuslineEditor`,
`resolveName`, border helpers (`stripAnsi`, `isHorizontalBorder`,
`roundedEditorBorder`), and the `CustomEditor`/`EditorTheme`/`TUI` imports.
`/statusline off` no longer calls `setEditorComponent`. README updated, package
description was already footer-only.

## pi-toolview (`packages/pi-toolview/`)

Compact tool output for bash/read/edit/write/grep/find/ls. Key decisions:
- `renderShell: "self"` for tight spacing; off-mode draws full content through the same pill row
- Bash timing via `context.state`, error via `context.isError`
- `/toolview compact|full` (on/off aliases); instant toggle via `setToolsExpanded()`
- Duration formatting supports min/hours (commit 4db49f1)

## Next Steps

1. Commit restructure, push
2. User reinstalls: `pi install /Users/saeed/Workspace/pi-extensions/packages/pi-editor` (+ pi-statusline) and tests live
3. Open PR(s) when ready; merge order: pi-toolview first (merge commit), then pi-stash lands as its own commits
4. Publish each with version bump + tag → release workflow

## Note

This branch was rebased onto `pi-toolview`, so toolview's commits are in this
history with the same SHAs (pi-toolview is an ancestor of pi-stash). Merge
pi-toolview's PR first as a merge commit; squash/rebase merges mint new SHAs
and re-show the other feature's diff. Merging stash first would make
toolview's PR a content no-op.