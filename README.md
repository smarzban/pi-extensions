# pi-extensions

Extensions for [pi](https://github.com/earendil-works/pi), the terminal-based coding agent.

| Package | Description |
|---------|-------------|
| [pi-pacman](packages/pi-pacman) | Pac-Man working indicator — pellet runs, ghost chases, arcade tunnels, fruit bonuses |

## Install

```bash
# from npm (after publish)
pi install npm:@pi-extensions/pi-pacman

# from this git repo (package path)
pi install git:github.com/smarzban/pi-extensions

# local path (this monorepo)
pi install /absolute/path/to/pi-extensions/packages/pi-pacman
```

### Publish a package

Tag-driven OIDC release (no long-lived npm token). Full steps: [docs/releases.md](docs/releases.md).

```bash
# bump packages/pi-pacman/package.json version, commit to main, then:
git tag v0.1.0 && git push origin v0.1.0
```

See each package's README for setup and usage.

## Structure

```
pi-extensions/
├── package.json              # private workspaces monorepo
├── AGENTS.md
├── LICENSE
├── README.md
└── packages/
    └── pi-pacman/
        ├── package.json
        ├── index.ts
        ├── README.md
        └── LICENSE
```

Modeled after [ogulcancelik/pi-extensions](https://github.com/ogulcancelik/pi-extensions).
