# pi-extensions

**Pi packages monorepo**: installable [pi](https://github.com/earendil-works/pi) coding-agent extensions, published under the npm scope [`@smarzban`](https://www.npmjs.com/~smarzban).

Each package under `packages/` is independent: its own `package.json`, entrypoint, README, and version. Users usually install **one package via npm**. Git monorepo install loads every package; local path installs a single package directory.

## Highlights

- **One extension per package**: no cross-package dependencies
- **TypeScript, no build step**: pi loads sources via jiti
- **npm scope `@smarzban`**: scoped, public packages with `pi-package` keywords for gallery discoverability
- **Tag-driven releases**: per-package `pi-<name>-vX.Y.Z` → GitHub Actions OIDC → npm

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| [pi-pacman](packages/pi-pacman) | [`@smarzban/pi-pacman`](https://www.npmjs.com/package/@smarzban/pi-pacman) | Pac-Man working / thinking indicator |
| [pi-statusline](packages/pi-statusline) | [`@smarzban/pi-statusline`](https://www.npmjs.com/package/@smarzban/pi-statusline) | Footer statusline: model/effort, context, cost, provider usage, git branch/diff and PR |
| [pi-toolview](packages/pi-toolview) | [`@smarzban/pi-toolview`](https://www.npmjs.com/package/@smarzban/pi-toolview) | Compact tool output: one-line summaries (expandable) instead of raw output |
| [pi-editor](packages/pi-editor) | [`@smarzban/pi-editor`](https://www.npmjs.com/package/@smarzban/pi-editor) | Rounded input editor box + draft copy (alt+c) + stash (alt+s, per project) |
| [pi-usage](packages/pi-usage) | [`@smarzban/pi-usage`](https://www.npmjs.com/package/@smarzban/pi-usage) | Private local token-usage dashboard for Pi, Claude Code, Codex CLI, and Grok Build |
| [pi-spawn](packages/pi-spawn) | [`@smarzban/pi-spawn`](https://www.npmjs.com/package/@smarzban/pi-spawn) | Fan out a confirmed brief to named Pi agents in parallel, then synthesize |
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

Install a package into pi (example: pi-pacman):

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

Details: [docs/install/](docs/install/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Releases are tag-driven (per-package `pi-<name>-v*`) via GitHub Actions OIDC. See [docs/releases.md](docs/releases.md).

## License

[MIT](LICENSE) © Saeed Marzban
