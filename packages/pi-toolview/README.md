# pi-toolview

Compact tool output display for [pi](https://github.com/earendil-works/pi).

Replaces pi's verbose built-in tool rendering with one-line summaries, expandable on demand (ctrl+o). Execution is fully delegated to the originals, so the LLM still sees complete output.

## Before / after

**Default pi** shows full tool output inline — every line of bash, every file read, full diffs, etc.

**With pi-toolview:**

```
$ npm test
✓ · 42 lines · 12.3s

read src/app.ts (offset=100, limit=50)
85 lines (truncated from 200)

edit src/utils.ts (3 changes)
+12 / -4 in parseConfig

write dist/output.js (156 lines · 4.2 KB)
Written

grep /TODO/ in src --glob=*.ts
7 matches

find *.test.ts in src
23 results

ls packages
12 entries

$ rm nonexistent
✗ exit 1 · 2 lines · 0.0s
```

Press **ctrl+o** to expand all and see actual output, diffs, or search matches.

## Install

```bash
pi install /path/to/pi-extensions/packages/pi-toolview
```

## Features

| Feature | Example |
|---------|---------|
| **Smart paths** | `src/utils.ts` inside project, `~/code/file.ts` under HOME, absolute otherwise |
| **Bash timing** | `✓ · 42 lines · 12.3s` — measured via render state, same as built-in |
| **Write file size** | `(156 lines · 4.2 KB)` — catch accidental huge writes |
| **Error emphasis** | `✗ exit 1` in red, based on the tool's isError flag |
| **Edit context hint** | `+12 / -4 in parseConfig` — enclosing function from diff |
| **Per-tool control** | `/toolview bash full` — that tool shows full output |

## Commands

| Command | Effect |
|---------|--------|
| `/toolview` | Show current status |
| `/toolview compact` | All tools compact (summaries) |
| `/toolview full` | All tools full output |
| `/toolview <tool>` | Toggle one tool (e.g. `/toolview bash`) |
| `/toolview <tool> compact` | One tool compact |
| `/toolview <tool> full` | One tool full output |

`on`/`off` are accepted as aliases for `compact`/`full`.

Tools: `bash`, `read`, `edit`, `write`, `grep`, `find`, `ls`

State persists in `~/.pi/agent/toolview.json`.

## Tools

| Tool | Collapsed | Expanded (ctrl+o) |
|------|-----------|-------------------|
| bash | `✓` / `✗ exit N` + lines + timing | First 30 lines |
| read | Line count + truncation | First 20 lines |
| edit | `+N / -N` + function hint | Full diff (40 lines) |
| write | `Written` | N/A |
| grep | Match count (0 = muted) | First 20 matches |
| find | Result count | First 20 paths |
| ls | Entry count | First 20 entries |

## Partial override

Want to keep some tools at default? Use `/toolview bash full` to show full output for just bash. Or copy `index.ts` and delete the `pi.registerTool()` block for any tool.

## How it works

- Re-registers each built-in tool with the same name (pi uses the last registration)
- `execute()` delegates to the original `create*Tool(cwd)` factory, behavior is identical
- Bash timing uses the same `context.state` mechanism the built-in renderer uses
- `renderShell: "self"` drops the default padded Box for a tighter look; the
  success/error/pending background color is re-applied manually. Pi hardcodes one
  blank line above every tool block, so a single separator remains.
- When a tool is toggled off, its full result content is drawn through the same
  pill row. The native per-tool renderers are built for the Box shell and lose their
  background in the tight self frame, so they are not delegated to.
- `/toolview` toggles re-render already-drawn blocks immediately, no `/reload` needed
- Only `renderCall()` and `renderResult()` are custom (TUI display only)
- The LLM still receives full, unmodified `result.content`
- When disabled via `/toolview`, falls back to the original tool's renderer
- State reconstruction from session history works normally

## License

MIT
