# Install

How to load packages from this monorepo into [pi](https://github.com/earendil-works/pi).

## pi-pacman

### npm (recommended)

```bash
pi install npm:@pi-extensions/pi-pacman
```

Pin a version:

```bash
pi install npm:@pi-extensions/pi-pacman@0.1.0
```

### git (monorepo)

Installs the whole repo; the root `package.json` declares:

```json
"pi": { "extensions": ["./packages/pi-pacman"] }
```

```bash
pi install git:github.com/smarzban/pi-extensions
```

### local path

For development against a checkout:

```bash
pi install /absolute/path/to/pi-extensions/packages/pi-pacman
```

Relative paths in `~/.pi/agent/settings.json` are resolved against that settings file’s directory.

### One-shot (no install)

From the package directory:

```bash
pi --extension ./index.ts
```

## After install

1. Restart pi or open a new session.
2. Confirm with `/pacman` (status notify) or by streaming a reply.
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
| Node | Package engines: `>=18` (CI uses Node 20) |
| Terminal | Unicode + truecolor recommended for glyphs/colors |

## Related

- [releases.md](../releases.md) — publishing new versions  
- [development.md](../development.md) — working from a clone  
