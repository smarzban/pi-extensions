# pi-editor

Two input-editor features in one package: a rounded editor box and a draft
stash, plus a shortcut that copies the underlying draft without the visual
box or line wrapping. They share pi's input-editor extension surface (the
editor component, plus `getEditorText`/`setEditorText` and shortcuts), so they
ship together.

```
╭─────────────────────────╮
│ › text box              │
╰─────────────────────────╯
```

## Rounded editor box

Draws a rounded border around the input editor. The default box is square;
this one is rounder. The session name can be shown as a right-aligned label on
the top or bottom border, toggled per command:

| Command | Effect |
|---------|--------|
| `/editor` | Box + label status |
| `/editor on` / `/editor off` | Toggle the rounded box |
| `/editor name on` / `/editor name off` | Toggle the session name label |
| `/editor name top` / `/editor name bottom` | Label position |

The box is on as soon as the package is installed; `/editor off` turns it off
and the choice sticks. If you had previously turned the old pi-statusline box
off, that preference lived in `statusline.json` and does not carry over: turn it
off once here.

Settings persist to `~/.pi/agent/editor.json` (`enabled`, `sessionName`,
`sessionNamePosition`).

## Copy editor draft

Press `alt+c` to copy the full logical editor contents. This copies the actual
draft rather than terminal screen cells, so rounded borders and visual line
wrapping are excluded. An empty editor is left unchanged and reports that
there is nothing to copy.

## Draft stash

`alt+s` parks a half-written prompt so you can go do something else; `alt+s`
again brings it back. Same idea as Claude Code's draft stash.

| Action | Effect |
|--------|--------|
| `alt+s` with text in the editor | Stash it (per project) and clear the editor |
| `alt+s` with an empty editor | Restore the stash into the editor (one-shot, the stash is then cleared) |
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
| `/editor` | Show box/label status |
| `/editor on` / `/editor off` | Toggle the rounded box |
| `/editor name on` / `/editor name off` | Toggle the session name label on the box |
| `/editor name top` / `/editor name bottom` | Label position |
| `alt+c` | Copy the full editor draft without borders or visual wrapping |
| `/stash` | Stash status for this project |
| `/stash clear` | Clear this project's stash |

## Install

```bash
pi install npm:@smarzban/pi-editor
```

## Shortcut note

On macOS, your terminal must send Option as Meta/Esc+ for `alt+c` and `alt+s` to work
(the default in iTerm2 profiles set to "Esc+", Ghostty via
`macos-option-as-alt`, and kitty via `macos_option_as_alt`), otherwise
Option may type symbols such as ç or ß instead.

## Development

```bash
# install locally
pi install /absolute/path/to/pi-extensions/packages/pi-editor
```

One extension, no build step: `index.ts` registers the custom editor
component, the `alt+c` copy shortcut, the `alt+s` stash shortcut, and the
`/editor` + `/stash` commands. The copy shortcut behavior is isolated in
`copy-draft.mjs` for dependency-free tests.

```bash
npm test
```
