# Changelog

All notable changes to packages in this monorepo are documented here.  
The npm package **`@pi-extensions/pi-pacman`** is versioned independently under `packages/pi-pacman`.

## [0.1.0] — 2026-07-17

### @pi-extensions/pi-pacman

Initial public release.

- Pac-Man working indicator via `setWorkingIndicator` / `setWorkingMessage`
- Looks: `classic`, `chase`, `mini`, `arcade`, `fruit`
- Commands: `/pacman` list, look lock, rotate, off, message, clear
- Persistence: `~/.pi/agent/pacman-thinking.json`
- Full-width tracks for classic/chase; 7-cell fixed looks
- Frame timing: 80 ms full-width, 110 ms fixed

### Monorepo

- GitHub Actions CI (`npm pack --dry-run` per package)
- Tag-driven OIDC release workflow for npm
