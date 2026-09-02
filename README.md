# pi-extensions

**Pi packages monorepo**: installable [pi](https://github.com/earendil-works/pi) coding-agent extensions. Published packages use the npm scope [`@smarzban`](https://www.npmjs.com/~smarzban); every tracked package is also installable from a local path or this repository.

Each package under `packages/` is independent: its own `package.json`, entrypoint, README, and version. Users usually install **one package via npm**. Git monorepo install loads every package; local path installs a single package directory.

## Highlights

- **One extension per package**: no cross-package dependencies
- **TypeScript, no build step**: pi loads sources via jiti
- **npm scope `@smarzban`**: scoped, public packages with `pi-package` keywords for gallery discoverability
- **Tag-driven releases**: per-package `pi-<name>-vX.Y.Z` → GitHub Actions OIDC → npm

## Packages

| Package | Current install | Description |
|---------|-----------------|-------------|
| [pi-pacman](packages/pi-pacman) | [`@smarzban/pi-pacman@0.1.2`](https://www.npmjs.com/package/@smarzban/pi-pacman) | Pac-Man working / thinking indicator |
| [pi-statusline](packages/pi-statusline) | [`@smarzban/pi-statusline@0.2.0`](https://www.npmjs.com/package/@smarzban/pi-statusline) | Footer statusline: model/effort, context, cost, provider usage, git branch/diff and PR |
| [pi-toolview](packages/pi-toolview) | [`@smarzban/pi-toolview@0.1.0`](https://www.npmjs.com/package/@smarzban/pi-toolview) | Compact tool output: one-line summaries (expandable) instead of raw output |
| [pi-editor](packages/pi-editor) | npm has `@smarzban/pi-editor@0.1.0`; source is `0.2.0`, use local path or git for the latest | Rounded input editor box + draft copy (alt+c) + stash (alt+s, per project) |
| [pi-usage](packages/pi-usage) | Source only, use local path or git | Private local token-usage dashboard for Pi, Claude Code, Codex CLI, and Grok Build |
| [pi-spawn](packages/pi-spawn) | [`@smarzban/pi-spawn@0.1.0`](https://www.npmjs.com/package/@smarzban/pi-spawn) | Fan out a confirmed brief to named Pi agents in parallel, then synthesize |
| [pi-review-panel](https://github.com/smarzban/pi-review-panel) | [`pi-review-panel`](https://www.npmjs.com/package/pi-review-panel) | Multi-model, evidence-only PR review panel |

Package docs, install, and commands live in each package’s README (e.g. [packages/pi-pacman/README.md](packages/pi-pacman/README.md)).

## Themes

The monorepo also includes two Pi themes:

| Theme | Description |
|-------|-------------|
| [Moonlight](themes/moonlight.json) | Dark theme with purple, teal, and blue accents |
| [Midnight](themes/midnight.json) | Dark theme with cyan, blue, and green accents |

Install the monorepo from git, then select a theme through Pi’s `/settings`.

## Quickstart

Install a package that is current on npm (example: pi-pacman):

```bash
pi install npm:@smarzban/pi-pacman
```

Restart pi (or start a new session) so the extension loads. See the package README for what to expect and how to configure it. `pi-usage` adds `/usage` for a local cross-harness token dashboard.

Other install methods:

| Method | Loads | Command |
|--------|-------|---------|
| **npm** (recommended) | One package | `pi install npm:@smarzban/<name>` |
| **local path** | One package | `pi install /absolute/path/to/pi-extensions/packages/pi-<name>` |
| **git** (whole monorepo) | All packages | `pi install git:github.com/smarzban/pi-extensions` |

For local verification and installation, see [docs/development.md](docs/development.md). Package-specific commands and configuration are in each package README.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Releases are per-package; see [docs/releases.md](docs/releases.md).

## License

[MIT](LICENSE) © Saeed Marzban
