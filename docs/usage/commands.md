# Commands (`/pacman`)

All commands are registered as the slash command **`pacman`**.

## Status

```text
/pacman
```

Shows current look, whether rotate is on, working message, and strip width (cells).

## Catalog

```text
/pacman list
/pacman help
/pacman looks
```

Renders the look list in a widget **below the editor**.

```text
/pacman clear
```

Hides that widget.

## Lock a look

```text
/pacman classic
/pacman chase
/pacman mini
/pacman arcade
/pacman fruit
```

Sets that look and **turns rotate off**. Unknown names error with a pointer to `/pacman list`.

See [looks.md](looks.md) for what each does.

## Rotate

```text
/pacman rotate
/pacman cycle
```

Enables cycle mode: on each `agent_start` (each user message turn), the next **short** look is applied. Full-width looks (`classic`, `chase`) are **not** in the rotation; pick them explicitly with `/pacman classic` etc.

Order:

`mini → arcade → fruit → (repeat)`

**Stop rotate** by locking a look (`/pacman mini`) or hiding (`/pacman off`).

## Hide

```text
/pacman off
/pacman none
/pacman hide
```

Hides the custom indicator (`frames: []`), clears the list widget, stops rotate. Status shows `ᗧ off`.

## Working message

By default, a **random arcade blurb** is chosen on every agent run (and at session start), e.g. `waka waka...`, `chomping tokens...`. It avoids repeating the same line twice in a row.

```text
/pacman message chomping tokens...
/pacman message
```

- With text: **lock** a custom message (stops auto-random).
- Empty: back to **auto-random** each run.

## Cells (fixed-look width)

```text
/pacman cells
/pacman cells 12
```

Controls the strip length for **mini / arcade / fruit** (default **10**, clamped **4–40**). Also settable as `"cells": 12` in the config file.

## Persistence

Look, rotate flag, rotate index, custom message, and cells are saved to `~/.pi/agent/pacman-thinking.json`. Details: [persistence.md](persistence.md).
