# pi-extensions

**Pi packages monorepo** — installable [pi](https://github.com/earendil-works/pi) coding-agent extensions published under the npm org [`@pi-extensions`](https://www.npmjs.com/org/pi-extensions).

Right now that means **Pac-Man for your thinking spinner**: replace pi’s streaming working indicator with pellet runs, ghost chases, maze tunnels, and fruit bonuses.

## Highlights

- **Drop-in working indicator** — uses `setWorkingIndicator` / `setWorkingMessage` (normal streaming only)
- **Five looks** — full-width `classic` & `chase`, plus 7-cell `mini`, `arcade`, `fruit`
- **Rotate mode** — cycle looks every agent message (`/pacman rotate`)
- **Remembers your choice** — look, rotate, and custom message in `~/.pi/agent/pacman-thinking.json`
- **Install three ways** — npm, git monorepo, or local path

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| [pi-pacman](packages/pi-pacman) | [`@pi-extensions/pi-pacman`](https://www.npmjs.com/package/@pi-extensions/pi-pacman) | Pac-Man working / thinking indicator |

## Quickstart

```bash
pi install npm:@pi-extensions/pi-pacman
```

Restart pi (or start a new session), send a message, and you should see a yellow `ᗧ` chomping pellets next to the working line.

```text
ᗧ······  waka waka...
```

Try:

```text
/pacman list
/pacman chase
/pacman rotate
```

Full command reference: [docs/usage/commands.md](docs/usage/commands.md).

## Install

| Method | Command |
|--------|---------|
| **npm** (recommended) | `pi install npm:@pi-extensions/pi-pacman` |
| **git** (whole monorepo) | `pi install git:github.com/smarzban/pi-extensions` |
| **local path** | `pi install /absolute/path/to/pi-extensions/packages/pi-pacman` |

Details and uninstall notes: [docs/install/](docs/install/README.md).

## Documentation

| Audience | Start here |
|----------|------------|
| **Users** | [docs/quickstart.md](docs/quickstart.md) · [docs/usage/](docs/usage/) |
| **Install / release** | [docs/install/](docs/install/README.md) · [docs/releases.md](docs/releases.md) |
| **Contributors** | [docs/development.md](docs/development.md) · [CONTRIBUTING.md](CONTRIBUTING.md) |
| **Overview** | [docs/architecture.md](docs/architecture.md) · [docs/README.md](docs/README.md) |

## Structure

```
pi-extensions/
├── packages/
│   └── pi-pacman/          # @pi-extensions/pi-pacman
│       ├── index.ts
│       └── package.json
├── docs/
└── .github/workflows/      # CI + OIDC npm release on v* tags
```

Modeled after [ogulcancelik/pi-extensions](https://github.com/ogulcancelik/pi-extensions).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Releases are tag-driven (`v*`) via GitHub Actions OIDC — [docs/releases.md](docs/releases.md).

## License

[MIT](LICENSE) © Saeed Marzban
