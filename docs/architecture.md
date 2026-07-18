# Architecture (overview)

Light map of how this monorepo and its packages fit together. Not a deep design doc.

## Monorepo

```
pi-extensions (git + npm org @pi-extensions)
└── packages/
    ├── pi-pacman        ← Pac-Man working indicator
    └── pi-statusline    ← rounded editor box + footer statusline
        └── index.ts     ← each package: an ExtensionAPI default export
```

- Root `package.json` is **private** workspaces metadata + `"pi.extensions"` listing every package for
  **git** installs of the whole repo.
- Each package is independently versioned and published to npm (see [releases.md](releases.md)).

## pi-pacman runtime

```
session_start ──► apply(look) ──► setWorkingIndicator + setWorkingMessage + setStatus
                      │
agent_start ──────────┼──► if rotate: next look, then apply
                      │    if full-width look: remeasure width, apply
                      │
terminal resize ──────┴──► rebuild full-width frames
session_shutdown ─────────► drop resize listener

/pacman … ──► mutate mode/rotate/message ──► apply ──► persist JSON
```

| Piece | Role |
|-------|------|
| **Look** | Named frame generator + default message + full-width flag |
| **Frames** | Precomputed ANSI strings; pi's loader advances them on `intervalMs` |
| **apply()** | Pushes indicator + message + footer status; writes state file |
| **State file** | `~/.pi/agent/pacman-thinking.json` via `getAgentDir()` |

## pi-statusline runtime

```
session_start ──► applyEditor (rounded box + bottom-right session name)
              └─► applyFooter  (model·effort, ctx, cost, git/PR)

turn_end / branch change ──► refresh git + debounced open-PR lookup via gh
/statusline usage on      ──► (opt-in) read auth + fetch provider quota, refresh every 5m
```

| Piece | Role |
|-------|------|
| **Editor border** | `CustomEditor` subclass draws a rounded box, `›` prompt, and bottom-right session name |
| **Footer** | `setFooter` renders `[model·effort] [ctx] [$cost] [usage] [git] [#pr]` |
| **Git/PR** | `git status --porcelain=v2` + debounced `gh pr view --json number,state`; only open PRs are shown |
| **Provider usage** | **Opt-in, off by default**: reads auth + calls provider API; Codex only |
| **State file** | `~/.pi/agent/statusline.json` (`enabled`, `usageEnabled`) via `getAgentDir()` |

## Trust / surface boundary

Both packages run with pi's privileges (see [SECURITY.md](../SECURITY.md)). Their actual surface:

| | pi-pacman | pi-statusline |
|-|-----------|---------------|
| Tools registered | none | none |
| Repo writes | none (state file only) | none (state file only) |
| Subprocesses | none | `git`, `gh` (read-only) |
| Network / credentials | none | **only when `/statusline usage on`**: reads `~/.pi/agent/auth.json` (+ `~/.codex/auth.json`) and calls the provider's usage API. Off by default. |

Both affect **interactive UI only** (working indicator / footer), never the agent's tool set or messages.

## Releases

```
tag pi-<name>-vX.Y.Z on main ──► release.yml ──► OIDC ──► npm publish @pi-extensions/<name>
```

See [releases.md](releases.md).

## Deeper docs

Package sources: [pi-pacman/index.ts](../packages/pi-pacman/index.ts) · [pi-statusline/index.ts](../packages/pi-statusline/index.ts).
Pi extension API: [pi extensions docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).
