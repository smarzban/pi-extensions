# pi-extentions

Extensions for [pi](https://github.com/earendil-works/pi), the terminal-based coding agent.

| Package | Description |
|---------|-------------|
| [pi-pacman](packages/pi-pacman) | Pac-Man working indicator — pellet runs, ghost chases, arcade tunnels, fruit bonuses |

## Install

```bash
# from npm (after publish)
pi install npm:pi-pacman

# from this git repo (package path)
pi install git:github.com/smarzban/pi-extentions

# local path (this monorepo)
pi install /absolute/path/to/pi-extentions/packages/pi-pacman
```

### Publish a package

```bash
cd packages/pi-pacman
npm login
npm publish --access public
```

See each package's README for setup and usage.

## Structure

```
pi-extentions/
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
