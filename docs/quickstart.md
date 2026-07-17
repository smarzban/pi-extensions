# Quickstart

Fastest path to Pac-Man on pi’s working line.

## 1. Install

```bash
pi install npm:@pi-extensions/pi-pacman
```

Requires [pi](https://github.com/earendil-works/pi) with interactive (TUI) mode. The indicator only appears while the agent is **streaming a normal response** — not during compaction/retry loaders.

## 2. Restart pi

Start a new session (or restart the process) so the package loads.

## 3. Send a message

You should see something like:

```text
ᗧ······  waka waka...
```

Default look is **classic** (full-width pellet run). Footer status shows `ᗧ classic` while the extension is active.

## 4. Try a few commands

In the pi input:

```text
/pacman list
/pacman chase
/pacman mini
/pacman rotate
```

| Command | Result |
|---------|--------|
| `/pacman list` | Catalog under the editor |
| `/pacman chase` | Full-width ghost hunt |
| `/pacman rotate` | New look every message |
| `/pacman classic` | Lock classic (stops rotate) |

Next: [usage/commands.md](usage/commands.md) · [usage/looks.md](usage/looks.md) · [install/](install/README.md)
