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

Enables cycle mode: on each `agent_start` (each user message turn), the next look in the list is applied. Order:

`classic → chase → mini → arcade → fruit → (repeat)`

**Stop rotate** by locking a look (`/pacman classic`) or hiding (`/pacman off`).

## Hide

```text
/pacman off
/pacman none
/pacman hide
```

Hides the custom indicator (`frames: []`), clears the list widget, stops rotate. Status shows `ᗧ off`.

## Working message

```text
/pacman message chomping tokens...
/pacman message
```

- With text: custom message (overrides the look’s default).
- Empty: reset to the current look’s default (`waka waka...`, `run from blinky...`, etc.).

## Defaults by look

| Look | Default message |
|------|-----------------|
| classic | `waka waka...` |
| chase | `run from blinky...` |
| mini | `chomp chomp...` |
| arcade | `insert coin...` |
| fruit | `fruit bonus...` |

## Persistence

Look, rotate flag, rotate index, and custom message are saved to `~/.pi/agent/pacman-thinking.json`. Details: [persistence.md](persistence.md).
