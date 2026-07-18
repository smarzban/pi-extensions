# Contributing

Thanks for helping with **pi-extensions**.

## Dev setup

See [docs/development.md](docs/development.md):

```bash
git clone git@github.com:smarzban/pi-extensions.git
cd pi-extensions
cd packages/pi-pacman && npm pack --dry-run   # canonical verify
pi install "$PWD"                             # load local package into pi
```

## Verify before you push

CI runs Node 20 and packs every package:

```bash
for pkg in packages/*/; do (cd "$pkg" && npm pack --dry-run); done
```

## Commit style

Recent history uses **Conventional Commits**, for example:

- `chore: …`
- `fix: …`
- `chore(pi-pacman): 0.1.1`

Prefer that form. Area scopes (`pi-pacman`, `docs`, `release`) are welcome when useful.

## Pull requests

- Use the PR template.
- Keep packages independent (no cross-package runtime deps).
- Update `docs/usage/` when user-facing behavior changes.
- CODEOWNERS: default reviewer `@smarzban`.

## Releases

Maintainers: bump `packages/<name>/package.json` version on `main`, then push a **per-package** tag:

```bash
git tag pi-pacman-v0.1.1        # pi-<name>-vX.Y.Z
git push origin pi-pacman-v0.1.1
```

Each package releases independently.

Requires npm Trusted Publisher (see [docs/releases.md](docs/releases.md)). Do not commit npm tokens.

## Code of conduct / security

- Security reports: [SECURITY.md](SECURITY.md)
- Be respectful in issues and PRs; we have not adopted a formal CoC file yet.
