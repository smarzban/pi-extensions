# HANDOFF.md

## Current State

Built `pi-toolview` extension for pi (compact tool output display).

**Status**: Working, PR open at https://github.com/smarzban/pi-extensions/pull/11

**Branch**: `pi-toolview` (based on `main`)

**Latest commit**: `adb46b3` - renamed `/toolview on|off` to `/toolview compact|full` (with on/off as aliases)

## What's Done

### pi-toolview Extension

Compact tool output for pi's 7 built-in tools (bash, read, edit, write, grep, find, ls).

**Features**:
- One-line summaries instead of full output (e.g., `✓ · 42 lines · 12.3s`)
- Smart paths (relative inside cwd, `~/` under HOME)
- Bash timing (via render state, not parsed from text)
- Write file size display
- Error emphasis (✗ prefix in red)
- Edit context hint (shows enclosing function from diff)
- `/toolview compact|full` command to toggle (per-tool or global)
- Instant toggle (no `/reload` needed) via `setToolsExpanded()`

**Architecture**:
- Re-registers each built-in tool with same name
- `execute()` delegates to original `createXTool(cwd)` factory
- `renderShell: "self"` drops default Box padding for tight look
- `row()` helper re-applies success/error/pending background manually
- Off-mode renders full content through `row()` (not native renderers)

## Key Decisions & Gotchas

### renderShell: "self" Trade-off

Used `renderShell: "self"` on all 7 tools to drop Box padding for tight spacing. This means:
- ✅ Tight spacing when compact (on)
- ❌ Native renderers break in self container (lose background/padding)
- ✅ Solution: off-mode renders full content through `row()` instead of delegating to native

**Why not delegate to native renderers when off?**
Native renderers (bash/read/grep/find/ls) reuse `context.lastComponent` and call `.clear()`/`.addChild()` on it. After compact rendering, that slot holds a plain `Text` (not a Container), so delegation throws. Edit works because it's self-shell native and builds fresh components.

**Workaround implemented**: Off-mode renders `result.content[0].text` through `row()` with bg/padding. Edit off-mode renders colored diff through `row()`.

### Bash Timing

Pi doesn't put "Took Xs" in output text. The built-in tracks timing via `context.state` (startedAt/endedAt). Toolview uses the same mechanism:
```typescript
type BashRenderState = { startedAt?: number; endedAt?: number };
// In renderCall: state.startedAt = Date.now()
// In renderResult: state.endedAt ??= Date.now()
```

### Error Detection

Non-zero exits come back as error results (`isError: true`), not "exit code:" in text. Toolview checks `context.isError` and parses "Command exited with code N" from the status line.

### Instant Toggle

`/toolview` toggles apply immediately via:
```typescript
ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded())
```
This re-runs `renderCall`/`renderResult` on all existing blocks.

### State Persistence

State in `~/.pi/agent/toolview.json`:
```json
{
  "enabled": true,
  "tools": { "bash": false, "read": false }
}
```
- `enabled`: global toggle
- `tools`: per-tool overrides (false = full output)
- `/toolview compact` clears `tools` map (sets all compact)
- `/toolview full` clears `tools` map (sets all full)

### Command Verbs

- Primary: `compact` / `full`
- Aliases: `on` / `off` (for compatibility)
- Per-tool: `/toolview bash compact` or `/toolview bash full`
- Toggle: `/toolview bash` (toggles single tool)

## What's Not Done

### Wishlist Items (Deferred)

1. **ctrl+s draft stash** (Claude Code style) - Not built yet. Would need `pi.registerShortcut("ctrl+s")` + `getEditorText()`/`setEditorText()` + `appendEntry()` for persistence.

2. **Double-paste to expand** - Partially feasible. Extension can't easily see raw paste events. Could add a shortcut to re-insert clipboard via `setEditorText()` (bypasses collapse).

3. **Prompt pinning at top** - Partially feasible. `ctx.ui.setHeader()` exists but unverified if it stays pinned during streaming. No mouse support in pi-tui (can't click to jump).

### Testing

- No automated tests yet
- Manual testing via `pi install /path/to/pi-extensions/packages/pi-toolview`
- Verified all 7 tools render correctly in both compact and full modes

### Documentation

- README.md is comprehensive
- No usage guide or examples beyond README

## Next Steps

1. **Merge PR** - PR #11 is ready for review/merge
2. **Publish to npm** - After merge, tag `pi-toolview-v0.1.0` and push to trigger release workflow
3. **User feedback** - See if the tight spacing + instant toggle meets expectations
4. **Wishlist items** - If user wants ctrl+s stash or other features, build those next

## Files

```
packages/pi-toolview/
├── index.ts          # Main extension (24KB, ~700 lines)
├── package.json      # Package metadata
├── README.md         # User documentation
└── LICENSE           # MIT
```

## Testing Locally

```bash
# Install from local path
pi install /Users/saeed/Workspace/pi-extensions/packages/pi-toolview

# Or test without installing
pi -e /Users/saeed/Workspace/pi-extensions/packages/pi-toolview/index.ts

# After changes, /reload in pi
```

## PR Status

- Branch: `pi-toolview`
- Base: `main`
- Commits: 10 (see git log)
- Status: Ready for review
- URL: https://github.com/smarzban/pi-extensions/pull/11
