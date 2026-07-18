# Development

Clone → verify → load into pi from a local path.

## Prerequisites

- Node.js **≥ 18** (CI uses **20**)
- git
- [pi](https://github.com/earendil-works/pi) installed for interactive testing

## Clone

```bash
git clone git@github.com:smarzban/pi-extensions.git
cd pi-extensions
```

No `npm install` is required (packages have no runtime `dependencies`; pi provides the
`@earendil-works/*` peer packages at load time).

## Canonical verify

From CI (`.github/workflows/ci.yml`):

```bash
# every package under packages/*/
for pkg in packages/*/; do
  (cd "$pkg" && npm pack --dry-run)
done
```

Or a single package:

```bash
cd packages/pi-pacman && npm pack --dry-run
```

There is **no compile step**: pi loads TypeScript via jiti.

## Load a local package into pi

```bash
pi install /absolute/path/to/pi-extensions/packages/pi-pacman
```

Or one-shot:

```bash
cd packages/pi-pacman
pi --extension ./index.ts
```

Restart the session after edits if the extension was already loaded (or use pi’s reload-runtime flow if you have it).

## Add a package

1. Create `packages/pi-<name>/` with `package.json`, `index.ts`, `README.md`, `LICENSE`
2. Set `"pi": { "extensions": ["./index.ts"] }`
3. Declare the pi packages you import in `"peerDependencies"` with `"*"` (e.g. `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`); pi provides them at load time
4. List it in the root README table and in root `package.json` `"pi.extensions"` if git-install of the monorepo should load it
5. Document usage under `docs/usage/`
6. Release with a per-package tag `pi-<name>-vX.Y.Z` (no workflow change needed)

See [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Release

Version bump in the package → tag `pi-<name>-vX.Y.Z` on `main` → [releases.md](releases.md).
Each package releases independently.
