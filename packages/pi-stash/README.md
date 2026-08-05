# pi-stash

Draft stash for pi's input editor. `ctrl+s` saves whatever you're typing,
per project; `ctrl+s` again with an empty editor restores it. Survives
sessions and restarts.

## Why

Sometimes you need to park a half-written prompt: go read a file, run a
command, start another task. Without a stash you copy the text out, or lose
it. `ctrl+s` is the same muscle memory as Claude Code's draft stash.

## Install

```bash
pi install npm:@pi-extensions/pi-stash
```

## Usage

| Action | Effect |
|--------|--------|
| `ctrl+s` with text in the editor | Stash it and clear the editor |
| `ctrl+s` with an empty editor | Restore the stash into the editor (one-shot, the stash is then cleared) |
| `/stash` | Show stash status for this project |
| `/stash clear` | Clear this project's stash |

The stash is keyed by the session's working directory: stashing in one
project never touches another project's stash. Stored in
`~/.pi/agent/stash.json` (one file, one entry per project path).

## How it works

- One stash per project, overwritten on re-stash
- Stash lives outside the session, so it restores in any session, even new
  ones
- The stash never enters the conversation: the LLM does not see it, and the
  session file is not touched

## Shortcut conflict note

pi binds `ctrl+s` to `app.session.toggleSort` (session tree) and
`app.models.save` (models selector) by default. Neither is reserved for
extensions and neither fires while the input editor is focused, so the
extension's `ctrl+s` wins in the editor. A benign "conflict" warning shows in
the extensions list; remap those two built-ins in your keybindings config if
you want it gone.

## Development

```bash
# install locally
pi install /absolute/path/to/pi-extensions/packages/pi-stash
```

This package is a single extension: `index.ts` registers the `ctrl+s`
shortcut and the `/stash` command. No build step.