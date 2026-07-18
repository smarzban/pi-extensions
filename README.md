# pi-extensions

**Pi packages monorepo**: installable [pi](https://github.com/earendil-works/pi) coding-agent extensions, published under the npm org [`@pi-extensions`](https://www.npmjs.com/org/pi-extensions).

Each package under `packages/` is independent: its own `package.json`, entrypoint, README, and version. Users usually install **one package via npm**. Git monorepo install loads every package; local path installs a single package directory.

## Highlights

- **One extension per package**: no cross-package dependencies
- **TypeScript, no build step**: pi loads sources via jiti
- **npm org `@pi-extensions`**: scoped, public packages with `pi-package` keywords for gallery discoverability
- **Tag-driven releases**: per-package `pi-<name>-vX.Y.Z` → GitHub Actions OIDC → npm

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| [pi-pacman](packages/pi-pacman) | [`@pi-extensions/pi-pacman`](https://www.npmjs.com/package/@pi-extensions/pi-pacman) | Pac-Man working / thinking indicator |
| [pi-statusline](packages/pi-statusline) | [`@pi-extensions/pi-statusline`](https://www.npmjs.com/package/@pi-extensions/pi-statusline) | Rounded editor box with bottom-right session name; model/effort, context, usage, git/PR footer |

Package docs, install, and commands live in each package’s README (e.g. [packages/pi-pacman/README.md](packages/pi-pacman/README.md)).

## Quickstart

Install a package into pi (example: pi-pacman):

```bash
pi install npm:@pi-extensions/pi-pacman
```

Restart pi (or start a new session) so the extension loads. See the package README for what to expect and how to configure it.

Other install methods:

| Method | Loads | Command |
|--------|-------|---------|
| **npm** (recommended) | One package | `pi install npm:@pi-extensions/<name>` |
| **local path** | One package | `pi install /absolute/path/to/pi-extensions/packages/pi-<name>` |
| **git** (whole monorepo) | All packages | `pi install git:github.com/smarzban/pi-extensions` |

Details: [docs/install/](docs/install/README.md).

## Documentation

| Audience | Start here |
|----------|------------|
| **Users (per package)** | [packages/pi-pacman/README.md](packages/pi-pacman/README.md) · [docs/usage/](docs/usage/) |
| **Install / release** | [docs/install/](docs/install/README.md) · [docs/releases.md](docs/releases.md) |
| **Contributors** | [docs/development.md](docs/development.md) · [CONTRIBUTING.md](CONTRIBUTING.md) |
| **Overview** | [docs/architecture.md](docs/architecture.md) · [docs/README.md](docs/README.md) |

## Structure

```
pi-extensions/
├── packages/
│   └── pi-<name>/          # one installable pi package each
│       ├── index.ts
│       ├── package.json    # "pi": { "extensions": [...] }
│       └── README.md
├── docs/
└── .github/workflows/      # CI + OIDC npm release on v* tags
```

Modeled after [ogulcancelik/pi-extensions](https://github.com/ogulcancelik/pi-extensions).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Releases are tag-driven (per-package `pi-<name>-v*`) via GitHub Actions OIDC. See [docs/releases.md](docs/releases.md).

## License

[MIT](LICENSE) © Saeed Marzban
