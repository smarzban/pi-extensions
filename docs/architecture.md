# Architecture (overview)

Light map of how this monorepo and pi-pacman fit together. Not a deep design doc.

## Monorepo

```
pi-extensions (git + npm org @pi-extensions)
└── packages/pi-pacman     ← one installable pi package
    └── index.ts           ← ExtensionAPI default export
```

- Root `package.json` is **private** workspaces metadata + `"pi.extensions"` for **git** installs of the whole repo.
- Each package is independently versioned and publishable to npm.

## pi-pacman runtime

```
session_start ──► apply(look) ──► setWorkingIndicator + setWorkingMessage + setStatus
                      │
agent_start ──────────┼──► if rotate: next look, then apply
                      │    if full-width look: remeasure width, apply
                      │
terminal resize ──────┴──► rebuild full-width frames

/pacman … ──► mutate mode/rotate/message ──► apply ──► persist JSON
```

| Piece | Role |
|-------|------|
| **Look** | Named frame generator + default message + full-width flag |
| **Frames** | Precomputed ANSI strings; pi’s loader advances them on `intervalMs` |
| **apply()** | Pushes indicator + message + footer status; writes state file |
| **State file** | `~/.pi/agent/pacman-thinking.json` via `getAgentDir()` |

## Trust / surface boundary

- UI-only extension: no tools, no network, no repo writes (except the agent-dir JSON state file).
- Affects **interactive streaming** working indicator only (not compaction/retry status rows).

## Releases

```
tag vX.Y.Z on main ──► release.yml ──► OIDC ──► npm publish @pi-extensions/pi-pacman
```

See [releases.md](releases.md).

## Deeper docs

Package source: [packages/pi-pacman/index.ts](../packages/pi-pacman/index.ts).  
Pi extension API: [pi extensions docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).
