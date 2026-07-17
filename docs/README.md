# Documentation

**pi-extensions** is a monorepo of [pi](https://github.com/earendil-works/pi) packages under the npm org `@pi-extensions`. Package-specific install and usage live in each package README (e.g. [pi-pacman](../packages/pi-pacman/README.md)); this tree holds shared install, release, and development docs plus the current package’s usage guides.

## Who starts where

| I want to… | Go to |
|------------|--------|
| See it work in under a minute | [quickstart.md](quickstart.md) |
| Install or switch install methods | [install/](install/README.md) |
| Learn every `/pacman` command | [usage/commands.md](usage/commands.md) |
| Pick a look (classic, chase, …) | [usage/looks.md](usage/looks.md) |
| Understand saved settings | [usage/persistence.md](usage/persistence.md) |
| Develop / add a package | [development.md](development.md) · [../CONTRIBUTING.md](../CONTRIBUTING.md) |
| Cut an npm release | [releases.md](releases.md) |
| See how the pieces fit | [architecture.md](architecture.md) |

## Index

```
docs/
├── README.md           ← you are here
├── quickstart.md
├── architecture.md
├── development.md
├── releases.md
├── install/
│   └── README.md
└── usage/
    ├── commands.md
    ├── looks.md
    └── persistence.md
```

Package-local READMEs (e.g. [packages/pi-pacman/README.md](../packages/pi-pacman/README.md)) lead with install/quickstart for that extension and link here for full guides.
