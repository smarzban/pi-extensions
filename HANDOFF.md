# HANDOFF.md

## Current State

**Branch**: `pi-stash` — rebased onto `pi-toolview`. Contains both features.

Two extensions, both implemented and verified headlessly:

1. **pi-toolview** (`packages/pi-toolview/`) — compact tool output, PR #11 open on the `pi-toolview` branch. Working.
2. **pi-stash** (`packages/pi-stash/`) — draft stash, ctrl+s. Working, being tested live by the user.

User's live-test feedback so far on pi-stash (all applied):
- Stash clears the editor ✓
- Restore is one-shot: restoring deletes the stash entry ✓

## pi-stash (`packages/pi-stash/`)

Draft stash, Claude Code style:
- `ctrl+s` with text → stash (per project, keyed by session cwd), **clears the editor**
- `ctrl+s` with empty editor → restore into editor, **stash consumed (one-shot)**
- `/stash` status, `/stash clear` clears this project's stash
- Persisted to `~/.pi/agent/stash.json` (one entry per cwd)
- Never touches the session file or the LLM

**Verified facts (from pi source, 2026-08-05)**:
- Extension shortcuts fire BEFORE app keybindings in the editor (custom-editor.js checks `onExtensionShortcut` first)
- `ctrl+s` is bound to `app.session.toggleSort` (session tree) and `app.models.save` (models selector) by default, but neither is in RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS, so the extension keeps it (benign "conflict" warning in extensions list; remap those two built-ins to silence)
- `getEditorText()`/`setEditorText()` and `ctx.cwd` available on both shortcut and command contexts
- `appendEntry` has NO read-back API, hence own stash file

## pi-toolview (`packages/pi-toolview/`)

Compact tool output for bash/read/edit/write/grep/find/ls. Full details in the original HANDOFF on the `pi-toolview` branch. Key decisions:
- `renderShell: "self"` for tight spacing; off-mode draws full content through the same pill row (native renderers lose their bg in the self shell)
- Bash timing via `context.state`, error via `context.isError`
- `/toolview compact|full` (on/off aliases); instant toggle via `setToolsExpanded()`
- **Duration formatting now supports min/hours** (commit 4db49f1): 12ms, 9.5s, 2m, 2h

## Next Steps

1. User finishes live-testing pi-stash (install: `pi install /Users/saeed/Workspace/pi-extensions/packages/pi-stash`)
2. Open PR for pi-stash when ready (this branch)
3. pi-toolview PR #11 still open on its own branch; merge order up to the user
4. Publish each with version bump + tag → release workflow

## Note

This branch was rebased onto `pi-toolview`, so it carries toolview's commits too. If pi-toolview's PR is merged first, this branch's copy of those commits will dedupe on merge; otherwise this branch can serve as the base for both.