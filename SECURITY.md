# Security

## Reporting a vulnerability

Please report security issues **privately** via GitHub Security Advisories for this repository:

**https://github.com/smarzban/pi-extensions/security/advisories/new**

Do not open a public issue for vulnerabilities.

## Scope

This monorepo ships pi **extensions** that run with the same privileges as pi itself (full local access). Review extension source before installing third-party packages. See pi’s own security guidance for the agent runtime.

### Per-package surface

- **pi-pacman**: UI only. No tools, no network, no repo writes (except its own state file in the pi agent dir).
- **pi-statusline**: UI only; runs read-only `git` and `gh` subprocesses. Its provider-quota feature is **opt-in and off by default**: only after `/statusline usage on` does it read `~/.pi/agent/auth.json` (and `~/.codex/auth.json`) and send the provider token to that provider's usage API (currently Codex, at `chatgpt.com`). With usage off, no auth files are read and no network calls are made.
- **pi-toolview**: intercepts built-in tool display and persists its own display configuration in the Pi agent directory.
- **pi-editor**: changes the editor UI and persists editor and draft-stash state in the Pi agent directory.
- **pi-usage**: reads local Pi and supported harness usage records, then stores its private usage index with owner-only file permissions.
- **pi-spawn**: starts configured child Pi processes or sends prompts to existing Herdr child sessions, then writes findings and run state under the Pi agent directory. Child agents run with full Pi tools; `spawn.json` configures their model, thinking level, default set, and timeout.
