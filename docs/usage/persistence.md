# Persistence

pi-pacman remembers preferences across sessions.

## File

```text
~/.pi/agent/pacman-thinking.json
```

Resolved via pi’s `getAgentDir()` (normally `~/.pi/agent`).

## Stored fields

| Field | Type | Meaning |
|-------|------|---------|
| `mode` | string | Look id (`classic`, `chase`, …) or `off` |
| `rotate` | boolean | Cycle looks each message |
| `rotateIndex` | number | Next index in the rotate list |
| `customMessage` | string? | Override for the working message |
| `cells` | number? | Fixed strip width for mini/arcade/fruit (default 10, clamped 4–40) |

Example:

```json
{
	"mode": "chase",
	"rotate": false,
	"rotateIndex": 2,
	"customMessage": "nom nom...",
	"cells": 10
}
```

## When it writes

On every `apply()`, including session start, look changes, rotate advances, and message updates. Failures to write are ignored (indicator still works).

## Migration

Older keys are still accepted on load:

- `mix: "rotate"` → `rotate: true`
- `mode` values `default`, `random`, `score` → treated as `classic`

## Reset

Delete the file, or:

```text
/pacman classic
/pacman message
```

(and turn off rotate by locking a look).
