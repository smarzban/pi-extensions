# Changelog

All notable changes to packages in this monorepo are documented here.
Each package is versioned and released independently under `packages/<name>`, via per-package tags
`pi-<name>-vX.Y.Z` (see [docs/releases.md](docs/releases.md)).

## Unreleased

### Monorepo

- Release workflow publishes any package from a per-package tag (`pi-<name>-vX.Y.Z`); each package
  versions and releases independently. Replaces the single `v*` tag that only published pi-pacman.

## pi-statusline 0.1.1 (2026-07-18)

- Clarify one-package npm and local-path installs versus whole-monorepo git installs.
- Make provider quota usage opt-in and keep it disabled by default.
- Avoid repeated GitHub PR lookups during normal turns.
- Add package peer dependencies and prepare independent package releases.

## pi-pacman 0.1.1 (2026-07-18)

- Restore the default fixed-look width to 10 cells.
- Add configurable fixed-look width through `/pacman cells` and persisted state.
- Remove fruit score pop frames.
- Clean up the resize listener during session shutdown.
- Add package peer dependencies and prepare independent package releases.

## pi-statusline 0.1.0 (2026-07-17)

Initial release.

- Session name on the editor top border; footer with model/effort, context, session cost, git
  branch/diff/ahead-behind, and PR number (via `gh`)
- Context and usage color thresholds (green / yellow / red)
- Provider quota display for **openai-codex**, opt-in and off by default: no auth files are read and
  no network calls are made until `/statusline usage on`. State in `~/.pi/agent/statusline.json`
- Declares `peerDependencies` (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`); Node `>=20`

## pi-pacman 0.1.0 (2026-07-17)

Initial release.

- Pac-Man working indicator via `setWorkingIndicator` / `setWorkingMessage`
- Looks: `classic`, `chase`, `mini`, `arcade`, `fruit`
- Commands: `/pacman` list, look lock, rotate, off, message, cells, clear
- Persistence: `~/.pi/agent/pacman-thinking.json`
- Full-width tracks for classic/chase; configurable fixed-look width (default 10 cells, range 4 to 40)
- Frame timing: 80 ms full-width, 110 ms fixed
- Declares `peerDependencies` (`@earendil-works/pi-coding-agent`); Node `>=18`
