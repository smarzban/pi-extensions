# Changelog

All notable changes to packages in this monorepo are documented here.
Each package is versioned and released independently under `packages/<name>`, via per-package tags
`pi-<name>-vX.Y.Z` (see [docs/releases.md](docs/releases.md)).

## Monorepo (2026-08-15)

- **npm scope moved from `@pi-extensions` to `@smarzban`**. The old `@pi-extensions/pi-pacman` and
  `@pi-extensions/pi-statusline` packages are frozen at their last published versions; new releases
  ship only as `@smarzban/pi-*`. Reinstall with `pi install npm:@smarzban/pi-<name>`.
- Release workflow publishes any package from a per-package tag (`pi-<name>-vX.Y.Z`); each package
  versions and releases independently. Replaces the single `v*` tag that only published pi-pacman.

## pi-editor 0.1.0 (2026-08-15)

Initial release.

- Rounded input editor box (moved out of pi-statusline), with an optional session-name label on the
  top or bottom border (`/editor name on|off|top|bottom`)
- `alt+s` draft stash, kept per project in `~/.pi/agent/stash.json`; `/stash` shows status,
  `/stash clear` clears
- Settings persist to `~/.pi/agent/editor.json`

## pi-statusline 0.2.0 (2026-08-15)

- **Breaking**: the rounded editor box moved to the new pi-editor package. `/statusline off` now
  restores the default footer only, and installing pi-statusline alone no longer draws the box.
- Add `[N t/s]` (decode-only output rate of the last measurable response) and `[ttft …]` (wait
  before the reply started) footer segments, both on by default, toggled with
  `/statusline tps on|off` and `/statusline ttft on|off`.
- Add an optional session name segment to the footer, toggled with `/statusline session on|off`.
- Make the open-PR segment a clickable OSC 8 hyperlink in terminals that support links.

## pi-toolview 0.1.0 (2026-08-15)

Initial release.

- Compact one-line tool output for pi's seven built-in tools, expandable on demand
- `/toolview compact|full` globally or per tool

## pi-statusline 0.1.3 (2026-07-22)

- Clear merged or closed pull requests from the footer promptly.
- Add gallery image metadata and bundle demo images.

## pi-pacman 0.1.2 (2026-07-22)

- Preserve externally edited config files.
- Add gallery image metadata and bundle demo images.

## pi-statusline 0.1.2 (2026-07-18)

- Redesign the editor as a rounded text box with a `›` prompt.
- Move the session name to the editor's bottom-right border.
- Keep model/effort and the remaining runtime statistics in the footer.
- Refresh the current branch's open PR after agent runs with a 30-second debounce (async, never blocks the UI), hiding merged or closed PRs.
- Prevent a cached footer branch from appearing after the checkout becomes detached or the branch is removed.

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
