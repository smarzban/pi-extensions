# pi-editor

Two input-editor features in one package: a rounded editor box and a draft
stash. They share pi's input-editor extension surface (the editor component,
plus `getEditorText`/`setEditorText` and shortcuts), so they ship together.

```
╭─────────────────────────╮
│ › text box              │
╰────────────── name ────╯
```

## Rounded editor box

Draws a rounded border around the input editor with the session name as a
right-aligned label on the bottom border. The default box is square; this one
is rounder and shows which session you're in.

## Draft stash

`ctrl+s` parks a half-written prompt so you can go do something else; `ctrl+s`
again brings it back. Same muscle memory as Claude Code's draft stash.

| Action | Effect |
|--------|--------|
| `ctrl+s` with text in the editor | Stash it (per project) and clear the editor |
| `ctrl+s` with an empty editor | Restore the stash into the editor (one-shot, the stash is then cleared) |
| `/stash` | Show stash status for this project |
| `/stash clear` | Clear this project's stash |

The stash is keyed by the session's working directory: stashing in one
project never touches another project's stash. Stored in
`~/.pi/agent/stash.json` (one file, one entry per project path). It lives
outside the session, so it restores in any session, even new ones, and never
enters the conversation: the LLM does not see it, and the session file is not
touched.

## Commands

| Command | Effect |
|---------|--------|
| `/editor` | Show whether the rounded box is on |
| `/editor on` / `/editor off` | Toggle the rounded box |
| `/stash` | Stash status for this project |
| `/stash clear` | Clear this project's stash |

## Install

```bash
pi install npm:@pi-extensions/pi-editor
```

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
pi install /absolute/path/to/pi-extensions/packages/pi-editor
```

One extension, no build step: `index.ts` registers the custom editor
component, the `ctrl+s` shortcut, and the `/editor` + `/stash` commands.