# @pi-extensions/pi-pacman

Pac-Man **working indicator** for [pi](https://github.com/earendil-works/pi) — replaces the streaming spinner with pellet runs, ghost chases, arcade tunnels, and fruit bonuses.

Part of the [pi-extensions](https://github.com/smarzban/pi-extensions) monorepo.

## Highlights

- **Drop-in working indicator** — uses `setWorkingIndicator` / `setWorkingMessage` (normal streaming only)
- **Five looks** — full-width `classic` & `chase`, plus 7-cell `mini`, `arcade`, `fruit`
- **Rotate mode** — cycle short looks every agent message (`/pacman rotate`)
- **Random working blurbs** — arcade + AI/token-flavored lines each run (or lock your own)
- **Remembers your choice** — look, rotate, and custom message in `~/.pi/agent/pacman-thinking.json`

## Quickstart

```bash
pi install npm:@pi-extensions/pi-pacman
```

Restart pi (or start a new session), send a message, and you should see a yellow `ᗧ` chomping pellets next to the working line:

```text
ᗧ······  waka waka...
```

Default look is **classic** (full-width pellet run). Footer status shows `ᗧ classic` while the extension is active.

The indicator only appears while the agent is **streaming a normal response** — not during compaction/retry loaders.

## Install

| Method | Command |
|--------|---------|
| **npm** (recommended) | `pi install npm:@pi-extensions/pi-pacman` |
| **git** (whole monorepo) | `pi install git:github.com/smarzban/pi-extensions` |
| **local path** | `pi install /absolute/path/to/pi-extensions/packages/pi-pacman` |

More detail: [docs/install](../../docs/install/README.md).

## Usage

```text
/pacman list
/pacman chase
/pacman rotate
/pacman message chomping tokens...
/pacman off
```

| Command | Result |
|---------|--------|
| `/pacman` | Current look, rotate, message, strip width |
| `/pacman list` | Catalog under the editor |
| `/pacman <look>` | Lock a look (stops rotate) |
| `/pacman rotate` | Cycle short looks every message |
| `/pacman message …` | Lock custom working text (empty = auto-random) |
| `/pacman off` | Hide indicator |

Full reference: [docs/usage/commands.md](../../docs/usage/commands.md).

## Looks

| Look | Notes |
|------|--------|
| `classic` | Full-width pellet run (default) |
| `chase` | Full-width Blinky hunt → power pellet → revenge |
| `mini` / `arcade` / `fruit` | 7-cell animations (**in rotate**) |

Details: [docs/usage/looks.md](../../docs/usage/looks.md). Persistence: [docs/usage/persistence.md](../../docs/usage/persistence.md).

## Documentation

| Doc | What |
|-----|------|
| [Quickstart](../../docs/quickstart.md) | Fastest path to first chomp |
| [Commands](../../docs/usage/commands.md) | Every `/pacman` subcommand |
| [Looks](../../docs/usage/looks.md) | Frame / width notes |
| [Persistence](../../docs/usage/persistence.md) | State file fields |
| [Architecture](../../docs/architecture.md) | How the extension hooks pi |
| [Releases](../../docs/releases.md) | Maintainer publish flow |

## License

[MIT](LICENSE)
