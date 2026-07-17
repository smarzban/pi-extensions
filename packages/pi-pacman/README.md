# pi-pacman

Pac-Man working indicator for [pi](https://github.com/earendil-works/pi).

Replaces the streaming spinner with pellet runs, ghost chases, arcade tunnels, and fruit bonuses.

## Install

```bash
# from npm (after publish)
pi install npm:@pi-extensions/pi-pacman

# local path (this monorepo)
pi install /absolute/path/to/pi-extentions/packages/pi-pacman
```

### Publish to npm

Releases are **tag-driven** (OIDC trusted publishing) — see [docs/releases.md](../../docs/releases.md).

```bash
# after version bump on main:
git tag v0.1.0 && git push origin v0.1.0
```

One-time: reservation publish with OTP + Trusted Publisher on npmjs.com (same doc).

Then anyone can:

```bash
pi install npm:@pi-extensions/pi-pacman
pi install npm:@pi-extensions/pi-pacman@0.1.0
```

## Commands

| Command | Effect |
|---------|--------|
| `/pacman` | Show current look |
| `/pacman list` | Catalog of looks |
| `/pacman <look>` | Lock to that look (stops rotate) |
| `/pacman rotate` | Cycle a different look every message |
| `/pacman off` | Hide the indicator (stops rotate) |
| `/pacman message <text>` | Custom working message |
| `/pacman message` | Reset message to look default |
| `/pacman clear` | Hide the look list widget |

### Looks

| Look | Vibe |
|------|------|
| `classic` | Full-width pellet run (default) |
| `chase` | Full-width Blinky hunt → revenge |
| `mini` | 7-cell pellet run |
| `arcade` | 7-cell maze tunnel |
| `fruit` | 7-cell cherry bonus |

Speeds: full-width **80ms**/frame · fixed **110ms**/frame.

## Persistence

Look, rotate on/off, rotate index, and custom message save to `~/.pi/agent/pacman-thinking.json`.

## One-shot (without install)

```bash
pi --extension ./index.ts
```
