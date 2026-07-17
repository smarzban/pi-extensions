# @pi-extensions/pi-pacman

Pac-Man **working indicator** for [pi](https://github.com/earendil-works/pi) — replaces the streaming spinner with pellet runs, ghost chases, arcade tunnels, and fruit bonuses.

Part of the [pi-extensions](https://github.com/smarzban/pi-extensions) monorepo.

## Install

```bash
pi install npm:@pi-extensions/pi-pacman
```

Other methods (git / local): [docs/install](../../docs/install/README.md).

## Quick use

Restart pi, send a message, then:

```text
/pacman list
/pacman chase
/pacman rotate
```

Full guides:

- [Quickstart](../../docs/quickstart.md)
- [Commands](../../docs/usage/commands.md)
- [Looks](../../docs/usage/looks.md)
- [Persistence](../../docs/usage/persistence.md)

## Looks (summary)

| Look | Notes |
|------|--------|
| `classic` | Full-width pellet run (default) |
| `chase` | Full-width Blinky hunt → revenge |
| `mini` / `arcade` / `fruit` | 7-cell animations |

## Release

Maintainers: [docs/releases.md](../../docs/releases.md).

## License

[MIT](LICENSE)
