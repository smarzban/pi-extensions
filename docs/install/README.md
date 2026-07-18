# Install

How to load packages from this monorepo into [pi](https://github.com/earendil-works/pi).

## One package vs whole monorepo

| Goal | How |
|------|-----|
| **Only one extension** (usual for users) | **npm** or a **local path** to that package under `packages/pi-<name>` |
| **Every package** in this repo | **git** monorepo install (or install each npm package you want) |

Prefer **npm** for day-to-day use. Git monorepo install is a convenience for cloning the whole
repo into pi; it is not the way to pick a single package.

## npm (recommended)

Installs **one package** per command. Run only the line(s) you want:

```bash
pi install npm:@pi-extensions/pi-pacman
pi install npm:@pi-extensions/pi-statusline
```

Pin a version:

```bash
pi install npm:@pi-extensions/pi-pacman@0.1.0
```

## git (whole monorepo)

Installs **every** package listed in the root `package.json`:

```json
"pi": { "extensions": ["./packages/pi-pacman", "./packages/pi-statusline"] }
```

```bash
pi install git:github.com/smarzban/pi-extensions
```

You cannot select a single package with this form. For one package only, use npm or a local path
to `packages/pi-<name>`.

## local path

Installs **one package**: point at that package directory (not the monorepo root).

For development against a checkout:

```bash
pi install /absolute/path/to/pi-extensions/packages/pi-pacman
pi install /absolute/path/to/pi-extensions/packages/pi-statusline
```

Relative paths in `~/.pi/agent/settings.json` are resolved against that settings file's directory.

## One-shot (no install)

From a package directory:

```bash
pi --extension ./index.ts
```

## After install

1. Restart pi or open a new session.
2. Confirm with the package's command (`/pacman`, `/statusline`) or by streaming a reply.
3. Settings live in `~/.pi/agent/settings.json` under `"packages"`.

## Uninstall

```bash
pi remove npm:@pi-extensions/pi-pacman
# or the exact source string shown by:
pi list
```

Also remove any leftover local/git entry if you installed more than one source for the same extension.

## Requirements

| Requirement | Notes |
|-------------|--------|
| pi coding agent | Interactive TUI mode |
| Node | pi-pacman `>=18`; pi-statusline `>=20` (CI uses Node 20) |
| Terminal | Unicode + truecolor recommended for glyphs/colors |
| `gh` (pi-statusline) | Optional, only for the PR number segment |

## Related

- [releases.md](../releases.md): publishing new versions
- [development.md](../development.md): working from a clone
