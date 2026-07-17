# AGENTS.md

## Routing guideline

Stranger litmus test: would this instruction make sense to a stranger who cloned this repo? If
no, it belongs in AGENTS.local.md.

A gitignored AGENTS.local.md may exist beside this file; if present, read and follow it before starting work.

Pointer files carry no content: edits go to AGENTS.md or AGENTS.local.md, never CLAUDE.md — it is a
frozen one-line pointer and says so in-file.

Lazy creation: if an agent has private-routed content (per the litmus test above) and no
AGENTS.local.md exists yet in this working copy, it creates one — the committed .gitignore entry
already covers it, so the pattern self-propagates to every clone.

@AGENTS.local.md

## Project overview

Pi extensions monorepo. Each package in `packages/` is an independent pi extension published (or
installable) on its own. Modeled after [ogulcancelik/pi-extensions](https://github.com/ogulcancelik/pi-extensions).

```
packages/
  pi-pacman/            # Pac-Man working indicator
```

Each package has its own `package.json` with `"pi": { "extensions": [...] }` declaring entry points.

## Build / test / verify

- Build: none — extensions are TypeScript loaded by pi via jiti (no compile step)
- Test: per-package if present (none yet for pi-pacman)
- Canonical verify: `cd packages/pi-pacman && npm pack --dry-run`
- Install local package into pi: `pi install /absolute/path/to/pi-extensions/packages/pi-<name>`
- Publish: bump version on `main`, tag `vX.Y.Z` matching `package.json`, push tag → `.github/workflows/release.yml` (OIDC). See [docs/releases.md](docs/releases.md).

## Conventions

- TypeScript, no build step
- Each package is independent — no cross-package dependencies
- Package layout: `packages/pi-<name>/{package.json,index.ts,README.md,LICENSE}`
- `"pi": { "extensions": ["./index.ts"] }` in each package's package.json
- Keywords include `pi-package` for gallery discoverability
- Available imports: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `@earendil-works/pi-ai`
- Pi extension docs: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md

### Adding a package

1. Create `packages/pi-<name>/` with `package.json`, `index.ts`, `README.md`, `LICENSE`
2. Set `"pi": { "extensions": ["./index.ts"] }` in package.json
3. List it in the root README table
