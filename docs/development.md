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

No root `npm install` is required for pi-pacman (the package has no runtime `dependencies`; pi provides `@earendil-works/pi-coding-agent` at load time).

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

There is **no compile step** — pi loads TypeScript via jiti.

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
3. List it in the root README table and in root `package.json` `"pi.extensions"` if git-install of the monorepo should load it
4. Document usage under `docs/usage/`

See [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Release

Version bump in the package → tag `vX.Y.Z` on `main` → [releases.md](releases.md).
